// Import required packages
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const fetch = require('node-fetch'); // You'll need to run: npm install node-fetch@2
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

    const database = client.db("yourDatabaseName"); // <-- ❗️ REPLACE with your database name
    const productsCollection = database.collection("products"); // <-- ❗️ REPLACE with your collection name

    // --- NEW AI Search Endpoint ---
    app.get('/ai-search', async (req, res) => {
        const { search, minPrice, maxPrice } = req.query;

        if (!search) {
            return res.status(400).json({ message: "A search query is required." });
        }

        try {
            // 1. Build the initial database query
            const mongoQuery = {
                title: { $regex: search, $options: 'i' } // Case-insensitive search
            };
            if (minPrice || maxPrice) {
                mongoQuery.price = {};
                if (minPrice) mongoQuery.price.$gte = parseFloat(minPrice);
                if (maxPrice) mongoQuery.price.$lte = parseFloat(maxPrice);
            }

            // 2. Fetch and pre-sort the data to get the most relevant items
            const relevantProducts = await productsCollection.find(mongoQuery).toArray();
            
            // Create a relevance score to find the best candidates for the AI
            const scoredProducts = relevantProducts.map(p => ({
                ...p,
                score: (p.rating?.rate || 0) * Math.log10((p.rating?.count || 1))
            })).sort((a, b) => b.score - a.score);

            // 3. Take the top 100 most relevant products to send to the AI
            const top100Products = scoredProducts.slice(0, 100);

            if (top100Products.length === 0) {
                return res.json([]); // Return empty if no products match
            }

            // 4. Construct the prompt for the Gemini API
            const systemPrompt = `You are an expert Amazon product curator. Your task is to analyze a JSON list of products and select the absolute top 10 best items. Base your decision on a combination of user ratings, the number of reviews (popularity), and overall value for the price. Return your answer ONLY as a clean JSON array of the top 10 product objects, ordered from best to worst. Do not include any explanatory text, markdown formatting, or anything outside of the JSON array. The product objects in your response must be the exact same objects you were given.`;
            const userPrompt = `From the following list of products, please select the top 10 best items based on my search for "${search}". Here is the list: ${JSON.stringify(top100Products)}`;
            
            // 5. Call the Gemini API
            // IMPORTANT: You need to have a GEMINI_API_KEY in your .env file
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`;
            
            const geminiResponse = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] }
                })
            });

            if (!geminiResponse.ok) {
                throw new Error(`Gemini API error! Status: ${geminiResponse.status}`);
            }

            const geminiData = await geminiResponse.json();
            const aiResponseText = geminiData.candidates[0].content.parts[0].text;
            
            // Clean the response to ensure it's valid JSON
            const cleanedJsonString = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const top10RankedProducts = JSON.parse(cleanedJsonString);

            res.json(top10RankedProducts);

        } catch (err) {
            console.error("❌ Failed during AI search:", err);
            res.status(500).json({ message: "Error performing AI search" });
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
