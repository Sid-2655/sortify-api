// Import required packages
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// --- Configuration ---
const USD_TO_INR_RATE = 87.64; // Current exchange rate

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

    // --- Atlas Search Endpoint with Data Conversion ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Build the Atlas Search stage
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
            
            // 2. Build the price filtering stage (still filtering on the original USD price)
            const matchStage = { $match: {} };
            if (minPrice || maxPrice) {
                // Convert INR range from query back to USD for database query
                const minPriceUSD = minPrice ? parseFloat(minPrice) / USD_TO_INR_RATE : null;
                const maxPriceUSD = maxPrice ? parseFloat(maxPrice) / USD_TO_INR_RATE : null;

                matchStage.$match.price = {};
                if (minPriceUSD) matchStage.$match.price.$gte = minPriceUSD;
                if (maxPriceUSD) matchStage.$match.price.$lte = maxPriceUSD;
            }

            // 3. Define the limit stage
            const limitStage = { $limit: 100 };

            // 4. Construct and run the pipeline
            const pipeline = Object.keys(matchStage.$match).length > 0 
                ? [searchStage, matchStage, limitStage]
                : [searchStage, limitStage];
            
            const products = await productsCollection.aggregate(pipeline).toArray();

            // 5. Convert data for the frontend AFTER fetching
            const convertedProducts = products.map(product => {
                return {
                    ...product,
                    price: product.price ? product.price * USD_TO_INR_RATE : 0,
                    listPrice: product.listPrice ? product.listPrice * USD_TO_INR_RATE : 0,
                    productURL: product.productURL ? product.productURL.replace('amazon.com', 'amazon.in') : '#'
                };
            });

            res.json(convertedProducts);

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
