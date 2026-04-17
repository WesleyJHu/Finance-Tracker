FROM node:20-alpine

WORKDIR /app

# Install timezone data
RUN apk add --no-cache tzdata

# Set timezone
ENV TZ=America/New_York

# Copy package files first (faster rebuilds)
COPY package.json package-lock.json ./

RUN npm install

# Copy rest of code
COPY . .

# Build app
RUN npm run build

# Start app
CMD ["npm", "start"]
