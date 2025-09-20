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

    // --- Atlas Search Endpoint with Improved Relevance ---
    app.get('/search', async (req, res) => {
        const { search, minPrice, maxPrice, page = 1 } = req.query;
        const limit = 50; // Number of items per page
        const skip = (parseInt(page) - 1) * limit;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Define the Atlas Search stage for Amazon-like relevance
            const searchStage = {
                $search: {
                    index: 'search',
                    "compound": {
                        "must": [{
                            "text": {
                                "query": search,
                                "path": "name",
                                "fuzzy": { "maxEdits": 1 }
                            }
                        }],
                        "should": [
                            {
                                // Heavily boost items where the search term is an exact phrase
                                "phrase": {
                                    "query": search,
                                    "path": "name",
                                    "score": { "boost": { "value": 10 } }
                                }
                            },
                            {
                                // Also boost items where the search term matches the sub_category
                                "text": {
                                    "query": search,
                                    "path": "sub_category",
                                    "score": { "boost": { "value": 5 } }
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
                            input: { $replaceAll: { input: { $replaceAll: { input: { $ifNull: ["$discount_price", "0"] }, find: ",", replacement: "" } }, find: "₹", replacement: "" } },
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

            // 6. Add skipping and limiting to the main pipeline for pagination
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
```

---
### Step 2: Update Your MongoDB Search Index (Crucial!)

For the new backend code to work, your Search Index needs to be aware of the `sub_category` field. This is a one-time change you need to make on the MongoDB Atlas website.

1.  **Go to the "Search" Tab:** In your Atlas dashboard, navigate to your `items` collection and click on the **"Search"** tab.

2.  **Edit the Index:** You will see your index named `search`. Click the **"Edit"** button.

3.  **Update the JSON Definition:** The JSON editor will open. It currently only indexes the `name` field. You need to add the `sub_category` field to it.

    Replace the current JSON with the following updated version:
    ```json
    {
      "mappings": {
        "dynamic": false,
        "fields": {
          "name": {
            "type": "string"
          },
          "sub_category": {
            "type": "string"
          }
        }
      }
    }
    

