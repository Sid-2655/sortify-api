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

async function run() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");

    const database = client.db("test"); // <-- ❗️ REPLACE with your database name
    const productsCollection = database.collection("items"); // <-- ❗️ REPLACE with your collection name

    // --- API Endpoint with Pagination ---
    app.get('/products', async (req, res) => {
      try {
        // Get the page and limit from query parameters, with default values
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50; // Send 50 items per page
        const skip = (page - 1) * limit;

        // Get the search query from the request
        const query = req.query.search || "";
        
        // Build the MongoDB query
        let mongoQuery = {};
        if (query) {
            mongoQuery = { title: { $regex: query, $options: 'i' } }; // Case-insensitive search
        }

        // Fetch a specific page of documents
        const products = await productsCollection.find(mongoQuery).skip(skip).limit(limit).toArray();
        
        // Get the total number of documents that match the search
        const totalProducts = await productsCollection.countDocuments(mongoQuery);

        res.json({
            totalPages: Math.ceil(totalProducts / limit),
            currentPage: page,
            products: products
        });

      } catch (err) {
        console.error("❌ Failed to fetch products:", err);
        res.status(500).json({ message: "Error fetching products from database" });
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