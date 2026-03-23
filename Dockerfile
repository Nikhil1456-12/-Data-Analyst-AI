# Use Python native image as it natively handles C-compiled Pandas/Matplotlib flawlessly
FROM python:3.11-slim

# Install system dependencies and Node.js v18
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

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
