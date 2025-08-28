// Import required packages
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error("MONGO_URI not found in .env file. Please add it.");
    process.exit(1);
}
const client = new MongoClient(uri);

// --- Main Connection and API Logic ---
async function run() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");

    const database = client.db("test"); 
    const productsCollection = database.collection("items");

    // --- Direct Database Search Endpoint (Using basic regex) ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Build the database query using your field names
            const mongoQuery = {
                title: { $regex: search, $options: 'i' } // Case-insensitive basic text search
            };
            if (minPrice || maxPrice) {
                mongoQuery.price = {};
                if (minPrice) mongoQuery.price.$gte = parseFloat(minPrice);
                if (maxPrice) mongoQuery.price.$lte = parseFloat(maxPrice);
            }

            // 2. Fetch products from the database
            const products = await productsCollection.find(mongoQuery).limit(100).toArray(); // Limit to 100 results

            res.json(products);

        } catch (err) {
            console.error("❌ Failed during database search:", err);
            res.status(500).json({ message: "Error performing search" });
        }
    });

    app.listen(port, () => {
      console.log(`🚀 Server is running on http://localhost:${port}`);
    });

  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

run();
