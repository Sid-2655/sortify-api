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

    // --- Atlas Search Endpoint with Relevance Sorting and Correct Price Filter ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice, page = 1 } = req.query;
        const limit = 50; // Number of items per page
        const skip = (parseInt(page) - 1) * limit;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Define the Atlas Search stage for relevance
            const searchStage = {
                $search: {
                    index: 'search', // Use the name of your Atlas Search index
                    compound: {
                        should: [
                            {
                                text: {
                                    query: search,
                                    path: 'name',
                                    score: { 'boost': { 'value': 3 } } // Boost exact matches
                                }
                            },
                            {
                                text: {
                                    query: search,
                                    path: 'name',
                                    fuzzy: { maxEdits: 1 }
                                }
                            }
                        ]
                    }
                }
            };
            
            // 2. Add a temporary field to convert string price to a number for filtering
            const addFieldsStage = {
                $addFields: {
                    priceAsNumber: {
                        $convert: {
                            input: { 
                                $replaceAll: { 
                                    input: { $ifNull: ["$discount_price", "0"] }, 
                                    find: ",", 
                                    replacement: "" 
                                } 
                            },
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

            // 5. Create a second pipeline to get the total count of matching documents
            const countPipeline = [...pipeline, { $count: 'total' }];
            const countResult = await productsCollection.aggregate(countPipeline).toArray();
            const totalProducts = countResult.length > 0 ? countResult[0].total : 0;

            // 6. Add sorting, skipping, and limiting to the main pipeline for pagination
            pipeline.push({ $skip: skip });
            pipeline.push({ $limit: limit });

            // 7. Run the main pipeline to get the products for the current page
            const products = await productsCollection.aggregate(pipeline).toArray();

            res.json({
                products: products,
                totalPages: Math.ceil(totalProducts / limit),
                currentPage: parseInt(page)
            });

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
