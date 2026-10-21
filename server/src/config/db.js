const mongoose = require('mongoose');

let memoryServer = null;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || require('./env').mongoUri;

  // 1. If a remote cloud URI is provided, attempt to connect
  if (uri && !uri.includes('127.0.0.1:27017')) {
    try {
      console.log(`[MongoDB] Connecting to remote database...`);
      const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
      return conn;
    } catch (err) {
      console.warn(`[MongoDB] Remote database connection failed (${err.message}). Falling back to embedded database...`);
    }
  }

  // 2. Try local MongoDB daemon if running
  if (uri && uri.includes('127.0.0.1:27017')) {
    try {
      const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
      console.log(`[MongoDB] Connected to local MongoDB at ${conn.connection.host}`);
      return conn;
    } catch (err) {
      console.log(`[MongoDB] Local MongoDB daemon not running. Booting embedded database...`);
    }
  }

  // 3. Zero-Config Embedded Database (Requires zero manual setup, works automatically on Render)
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    console.log(`[MongoDB] Starting zero-config embedded database...`);
    memoryServer = await MongoMemoryServer.create();
    const memUri = memoryServer.getUri();
    const conn = await mongoose.connect(memUri);
    console.log(`[MongoDB] Embedded database running & connected successfully!`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Fatal database error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
