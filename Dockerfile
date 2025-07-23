# Use official Node.js base image
FROM node:18

# Set working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your app files
COPY . .

# Expose the port your app runs on
EXPOSE 8081

# Command to run the app
CMD ["npm", "start"]
