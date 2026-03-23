# Use Node 20 as base image to support modern Vite 8 and React 19 builds Native
FROM node:20-bookworm-slim

# Install Python 3.11 and pip
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create a virtual environment for Python tools
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set working directory for the application
WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy main package.json and install Backend Node dependencies
COPY package*.json ./
RUN npm install

# Copy all application files (Backend and Frontend source)
COPY . .

# Build the React frontend
RUN npm run build

# Expose the API and unified static web port
EXPOSE 3001

# Start the unified monolithic backend
CMD ["npm", "start"]
