const { MongoClient } = require('mongodb');
require('dotenv').config();
// Replace this with the string you copied from the MongoDB Atlas website
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
    }
}

module.exports = { connectDB, client };