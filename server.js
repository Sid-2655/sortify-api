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

    // --- Direct Database Search Endpoint with Relevance Sorting ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Build the match stage for the aggregation pipeline
            const matchStage = {
                $match: {
                    $text: { $search: search } // Use text search for relevance
                }
            };

            // Add price range to the match stage if provided
            if (minPrice || maxPrice) {
                matchStage.$match.price = {};
                if (minPrice) matchStage.$match.price.$gte = parseFloat(minPrice);
                if (maxPrice) matchStage.$match.price.$lte = parseFloat(maxPrice);
            }

            // 2. Define the sorting stage based on text search relevance score
            const sortStage = {
                $sort: {
                    score: { $meta: "textScore" } // Sort by relevance
                }
            };
            
            // 3. Define the limit stage
            const limitStage = {
                $limit: 100 // Return the top 100 most relevant results
            };

            // 4. Run the aggregation pipeline
            const pipeline = [matchStage, sortStage, limitStage];
            const products = await productsCollection.aggregate(pipeline).toArray();

            res.json(products);

        } catch (err) {
            console.error("❌ Failed during database search:", err);
            // Check for a common error when the text index is missing
            if (err.message.includes('text index required')) {
                return res.status(500).json({ message: "Database is not configured for text search. Please create a text index on the 'title' field in your MongoDB collection." });
            }
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
