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

    // --- Atlas Search Endpoint ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Define the Atlas Search stage for the aggregation pipeline
            const searchStage = {
                $search: {
                    index: 'default', 
                    compound: {
                        must: [{
                            text: {
                                query: search,
                                path: 'title',
                                fuzzy: { maxEdits: 1 }
                            }
                        }]
                    }
                }
            };
            
            // 2. Define a separate stage for price filtering
            const matchStage = { $match: {} };
            if (minPrice || maxPrice) {
                matchStage.$match.price = {};
                if (minPrice) matchStage.$match.price.$gte = parseFloat(minPrice);
                if (maxPrice) matchStage.$match.price.$lte = parseFloat(maxPrice);
            }

            // 3. Define the limit stage
            const limitStage = { $limit: 100 };

            // 4. Construct the pipeline
            const pipeline = Object.keys(matchStage.$match).length > 0 
                ? [searchStage, matchStage, limitStage]
                : [searchStage, limitStage];

            // 5. Run the aggregation pipeline
            const products = await productsCollection.aggregate(pipeline).toArray();

            res.json(products);

        } catch (err) {
            console.error("❌ Failed during Atlas Search:", err);
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
