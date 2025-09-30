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

    // --- Atlas Search Endpoint with Amazon-Like Relevance ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice, page = 1 } = req.query;
        const limit = 50;
        const skip = (parseInt(page) - 1) * limit;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // This is the main aggregation pipeline
            const pipeline = [
                {
                    // STAGE 1: Perform the initial text search with relevance scoring
                    $search: {
                        index: 'search',
                        compound: {
                            must: [{
                                text: { query: search, path: "name", fuzzy: { maxEdits: 1 } }
                            }],
                            should: [
                                { phrase: { query: search, path: "name", score: { boost: { value: 10 } } } },
                                { text: { query: search, path: "sub_category", score: { boost: { value: 5 } } } }
                            ]
                        }
                    }
                },
                {
                    // STAGE 2: Safely convert ratings and reviews to numbers for scoring
                    $addFields: {
                        textScore: { $meta: "searchScore" },
                        ratingAsNumber: {
                            $convert: {
                                input: "$ratings", to: "double", onError: 0.0, onNull: 0.0
                            }
                        },
                        reviewsAsNumber: {
                             $convert: {
                                input: { $replaceAll: { input: { $ifNull: ["$no_of_ratings", "0"] }, find: ",", replacement: "" } },
                                to: "int", onError: 0, onNull: 0
                            }
                        }
                    }
                },
                {
                    // STAGE 3: Calculate a popularity score using the safe numbers
                    $addFields: {
                        popularityScore: {
                            $add: [
                                "$ratingAsNumber",
                                { $log10: { $add: ["$reviewsAsNumber", 1] } } // Add 1 to avoid log(0)
                            ]
                        }
                    }
                },
                {
                    // STAGE 4: Add the final combined score for ranking
                    $addFields: {
                        finalScore: {
                            $multiply: ["$textScore", { $add: ["$popularityScore", 1] }] // Add 1 to popularity to ensure it's never zero
                        }
                    }
                }
            ];

            // STAGE 5: Add price filtering stage if the user provided a price range
            if (minPrice || maxPrice) {
                // First, add a field to convert the price string (e.g., "₹32,990") to a number
                pipeline.push({
                    $addFields: {
                        priceAsNumber: {
                            $convert: {
                                input: { $replaceAll: { input: { $replaceAll: { input: { $ifNull: ["$discount_price", "0"] }, find: ",", replacement: "" } }, find: "₹", replacement: "" } },
                                to: "double", onError: 0.0, onNull: 0.0
                            }
                        }
                    }
                });
                
                // Then, add the match stage to filter by the price range
                const priceMatch = {};
                if (minPrice) priceMatch.$gte = parseFloat(minPrice);
                if (maxPrice) priceMatch.$lte = parseFloat(maxPrice);
                pipeline.push({ $match: { priceAsNumber: priceMatch } });
            }
            
            // STAGE 6: Sort all results by our final combined score
            pipeline.push({ $sort: { finalScore: -1 } });

            // STAGE 7: Create a parallel pipeline just to get the total count of results
            const countPipeline = [...pipeline, { $count: 'total' }];
            const countResult = await productsCollection.aggregate(countPipeline).toArray();
            const totalProducts = countResult.length > 0 ? countResult[0].total : 0;

            // STAGE 8: Add pagination (skip and limit) to the main pipeline for continuous scrolling
            pipeline.push({ $skip: skip });
            pipeline.push({ $limit: limit });

            // Run the main pipeline to get the final list of products for the current page
            const products = await productsCollection.aggregate(pipeline).toArray();

            // Send the response back to the frontend
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

