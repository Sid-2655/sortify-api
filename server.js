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

    // --- Atlas Search Endpoint (Updated for New Schema) ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Define the Atlas Search stage using the 'name' field
            const searchStage = {
                $search: {
                    index: 'search', // Use the name of your Atlas Search index
                    text: {
                        query: search,
                        path: 'name', // CORRECTED: Use 'name' field for searching
                        fuzzy: { maxEdits: 1 }
                    }
                }
            };
            
            // 2. Add a temporary field to convert string price to a number
            const addFieldsStage = {
                $addFields: {
                    priceAsNumber: {
                        $convert: {
                            // CORRECTED: This now removes both '₹' and ',' before converting
                            input: { $replaceAll: { input: { $ifNull: ["$discount_price", "0"] }, find: ",", replacement: "" } },
                            to: "double",
                            onError: 0.0,
                            onNull: 0.0
                        }
                    }
                }
            };

            // 3. Define the price filtering stage
            const matchStage = { $match: {} };
            if (minPrice || maxPrice) {
                matchStage.$match.priceAsNumber = {};
                if (minPrice) matchStage.$match.priceAsNumber.$gte = parseFloat(minPrice);
                if (maxPrice) matchStage.$match.priceAsNumber.$lte = parseFloat(maxPrice);
            }
            
            // 4. Construct the main pipeline
            const pipeline = [searchStage, addFieldsStage];
            if (Object.keys(matchStage.$match).length > 0) {
                pipeline.push(matchStage);
            }

            // 5. Add the limit stage
            pipeline.push({ $limit: 100 });

            // 6. Run the aggregation pipeline
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
