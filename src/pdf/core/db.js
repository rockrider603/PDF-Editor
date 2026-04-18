const { MongoClient } = require('mongodb');
require('dotenv').config();

const url = process.env.MONGO_URI;
const client = new MongoClient(url);
const dbName = 'pdf_extractor_db';

async function connectDB() {
    try {
        await client.connect();
        console.log("Connected successfully to MongoDB Atlas (Cloud)");
        return client.db(dbName).collection('pdf_images');
    } catch (err) {
        console.error("Cloud Connection Error:", err);
        throw err;
    }
}

module.exports = { connectDB, client };