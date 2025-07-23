

// Use TensorFlow.js COCO-SSD for browser object detection
// Make sure you have included the following in your HTML:
// <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0"></script>
// <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd"></script>

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const model = await cocoSsd.load();
        // Wait for 5 seconds before detecting
        await new Promise(resolve => setTimeout(resolve, 5000));
        const image = document.querySelector('#detectCanvas');
        if (!image) {
            throw new Error('Element #detectCanvas not found');
        }
        const detections = await model.detect(image);
        console.log('Detections:', detections);
    } catch (err) {
        console.error('Error loading model or detecting:', err);
    }
});