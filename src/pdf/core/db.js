const { MongoClient } = require('mongodb');
require('dotenv').config();

const url = process.env.MONGO_URI;
const client = url ? new MongoClient(url) : null;
const dbName = 'pdf_extractor_db';

async function connectDB() {
    if (!client) {
        console.warn("\n[DB] MONGO_URI not found in environment. Skipping database connection...");
        return null;
    }
    
    try {
        await client.connect();
        console.log("Connected successfully to MongoDB Atlas (Cloud)");
        return client.db(dbName).collection('pdf_images');
    } catch (err) {
        console.warn("\n[DB] Cloud Connection failed. Proceeding with File System only. Error:", err.message);
        return null;
    }
}

module.exports = { connectDB, client };