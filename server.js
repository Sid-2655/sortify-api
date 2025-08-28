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
            // 1. Build the Atlas Search stage using the 'name' field
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
            
            // 2. Build the full aggregation pipeline
            const pipeline = [
                searchStage,
                {
                    // Add a new field to convert string price to a number
                    $addFields: {
                        priceAsNumber: {
                            $convert: {
                                input: { $replaceAll: { input: "$discount_price", find: ",", replacement: "" } },
                                to: "double",
                                onError: 0.0, // Default to 0 if conversion fails
                                onNull: 0.0
                            }
                        }
                    }
                }
            ];

            // 3. Add the price filtering stage if prices are provided
            if (minPrice || maxPrice) {
                const priceMatch = {};
                if (minPrice) priceMatch.$gte = parseFloat(minPrice);
                if (maxPrice) priceMatch.$lte = parseFloat(maxPrice);
                pipeline.push({ $match: { priceAsNumber: priceMatch } });
            }

            // 4. Add the limit stage
            pipeline.push({ $limit: 100 });

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
