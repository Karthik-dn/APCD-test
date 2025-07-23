const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const PORT = process.env.PORT || 3001;

app.use(express.static("public"));

const rooms = {};

// Store multiple camera RTSP URLs by cameraId
// Store multiple camera RTSP URLs by cameraId
const CAMERA_RTSP_URLS = {};

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

app.use(express.json());

// Endpoint to set RTSP URL for a specific cameraId
// Helper to URL-encode password in RTSP URL
function encodeRtspUrl(rtspUrl) {
  // Only encode if not already encoded
  return rtspUrl.replace(
    /(rtsp:\/\/[^:]+:)([^@]+)(@)/,
    (match, p1, p2, p3) => p1 + encodeURIComponent(p2) + p3
  );
}

app.post('/start-camera-stream', (req, res) => {
  let { cameraId, rtspUrl } = req.body;
  console.log(`[POST] /start-camera-stream`, { cameraId, rtspUrl });
  if (cameraId && typeof cameraId === 'string' && rtspUrl && typeof rtspUrl === 'string') {
    rtspUrl = encodeRtspUrl(rtspUrl);
    CAMERA_RTSP_URLS[cameraId] = rtspUrl;
    console.log(`Camera stream added: ${cameraId} -> ${rtspUrl}`);
    // Broadcast updated camera list to all clients
    io.emit('camera-list', Object.keys(CAMERA_RTSP_URLS));
    res.json({ success: true });
  } else {
    console.warn('Invalid cameraId or RTSP URL received:', req.body);
    res.status(400).json({ success: false, error: 'Invalid cameraId or RTSP URL' });
  }
});

// MJPEG streaming route for a specific cameraId
app.get('/camera-stream', (req, res) => {
  const cameraId = req.query.cameraId;
  const rtspUrl = CAMERA_RTSP_URLS[cameraId];
  console.log(`[GET] /camera-stream for cameraId: ${cameraId}`);
  if (!rtspUrl) {
    console.warn(`Camera not found for cameraId: ${cameraId}`);
    res.status(404).send('Camera not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=ffserver',
    'Connection': 'close',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
  });

  console.log(`Starting ffmpeg for cameraId: ${cameraId}, RTSP: ${rtspUrl}`);
  const ffmpeg = spawn(ffmpegPath, [
    '-rtsp_transport', 'tcp', // Force TCP for RTSP
    '-i', rtspUrl,
    '-vf', 'scale=1280:720',
    '-f', 'mjpeg',
    '-q', '3',
    'pipe:1'
  ]);

  let frameBuffer = Buffer.alloc(0);
  const JPEG_START = Buffer.from([0xff, 0xd8]);
  const JPEG_END = Buffer.from([0xff, 0xd9]);

  ffmpeg.stdout.on('data', (chunk) => {
    frameBuffer = Buffer.concat([frameBuffer, chunk]);
    let start, end;
    while ((start = frameBuffer.indexOf(JPEG_START)) !== -1 && (end = frameBuffer.indexOf(JPEG_END, start)) !== -1) {
      const frame = frameBuffer.slice(start, end + 2);
      res.write(`--ffserver\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
      frameBuffer = frameBuffer.slice(end + 2);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('Failed to start ffmpeg:', err);
  });
  ffmpeg.on('close', (code, signal) => {
    console.log(`ffmpeg process closed for cameraId: ${cameraId} with code ${code}, signal ${signal}`);
  });

  req.on('close', () => {
    console.log(`Request closed for cameraId: ${cameraId}, killing ffmpeg.`);
    ffmpeg.kill('SIGTERM');
  });
});

io.on("connection", socket => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("join-room", ({ roomId, userName }) => {
    console.log(`User joined room: ${roomId}, userName: ${userName}, socketId: ${socket.id}`);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;

    // Send the list of peers (with names) to the newly joined user
    const peersInRoom = {};
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room) {
      for (const id of room) {
        const peerSocket = io.sockets.sockets.get(id);
        if (peerSocket && peerSocket.id !== socket.id) {
          peersInRoom[peerSocket.id] = peerSocket.userName || 'Peer';
        }
      }
    }
    socket.emit('peer-list', peersInRoom);
    // Send current camera list to newly joined user
    socket.emit('camera-list', Object.keys(CAMERA_RTSP_URLS));

    // Notify the new user of all existing peers (so they can initiate connections)
    socket.emit('new-user', { existingPeers: Object.keys(peersInRoom) });

    // Notify existing peers about the new user
    socket.to(roomId).emit("user-connected", {
      socketId: socket.id,
      userName: userName
    });

    // Notify the new user about all existing peers (so existing peers also initiate connections)
    Object.entries(peersInRoom).forEach(([peerId, peerName]) => {
      socket.emit("user-connected", {
        socketId: peerId,
        userName: peerName
      });
    });

    socket.on("offer", ({ target, offer, userName }) => {
      console.log(`Offer from ${socket.id} to ${target}`);
      io.to(target).emit("offer", { caller: socket.id, offer, userName: socket.userName });
    });

    socket.on("answer", ({ target, answer }) => {
      console.log(`Answer from ${socket.id} to ${target}`);
      io.to(target).emit("answer", { caller: socket.id, answer });
    });

    socket.on("ice-candidate", ({ target, candidate }) => {
      console.log(`ICE candidate from ${socket.id} to ${target}`);
      io.to(target).emit("ice-candidate", { from: socket.id, candidate });
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id} from room: ${socket.roomId}`);
      socket.to(socket.roomId).emit("user-disconnected", socket.id);
    });
  });
});

server.listen(PORT, () => console.log("Server running on http://localhost:" + PORT));
