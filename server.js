require('dotenv').config(); 
const express = require('express');
const { Pool } = require('pg'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3007;

// Middleware bindings
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// Initialize connection pool to Neon Cloud Database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon માટે આ લાઈન લોકલ અને પ્રોડક્શન બંનેમાં એરર આવતા રોકશે
});

pool.on('connect', () => {
    console.log('Connected seamlessly to the cloud database instance.');
});

pool.on('error', (err) => {
    console.error('Unexpected cloud database pool error:', err.message);
});

// Setup cloud DB tables and populate data if empty
async function initializeDatabaseSchema() {
    try {
        console.log("🛠️ Attempting to create and verify database tables...");
        
        // 1. Products Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                subtitle VARCHAR(255),
                price DECIMAL(10,2) NOT NULL,
                image_url TEXT
            )
        `);

        // 2. Users Table (Authentication)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. Orders Table (Purchase History & Shipping Details)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE SET NULL,
                items JSONB NOT NULL, -- Stores structural cart array dynamically
                total_amount DECIMAL(10,2) NOT NULL,
                shipping_name VARCHAR(255) NOT NULL,
                shipping_phone VARCHAR(50) NOT NULL,
                shipping_address TEXT NOT NULL,
                shipping_city VARCHAR(100) NOT NULL,
                shipping_zip VARCHAR(20) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("✅ All relational tables verified or created successfully.");

        // Count current product rows to check if seeding is needed
        const res = await pool.query("SELECT COUNT(*) AS count FROM products");
        const count = parseInt(res.rows[0].count, 10);
        console.log(`📊 Current product count in cloud: ${count}`);

        if (count === 0) {
            console.log("🌱 Database is empty. Seeding luxury products now...");
            const seedQuery = `
                INSERT INTO products (title, subtitle, price, image_url) VALUES ($1, $2, $3, $4)
            `;
            
            await pool.query(seedQuery, [
                "Renewal Botanical Elixir", 
                "Resurface. Revitalize. Renew.", 
                235.00, 
                "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=500"
            ]);
            
            await pool.query(seedQuery, [
                "Radiance Defense Serum", 
                "Brighten. Protect. Perfect.", 
                215.00, 
                "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&q=80&w=500"
            ]);
            
            await pool.query(seedQuery, [
                "Nourishing Face Elixir", 
                "Nourish. Balance. Glow.", 
                245.00, 
                "https://images.unsplash.com/photo-1617897903246-719242758050?auto=format&fit=crop&q=80&w=500"
            ]);

            console.log("🎉 Database seeded successfully with dynamic product inventory items.");
        }
    } catch (err) {
        console.error('❌ CRITICAL ERROR during schema initialization:', err);
    }
}

// Trigger initial setup
initializeDatabaseSchema();

/* --- API Endpoints --- */

// 1. REGISTER ENDPOINT: નવો યુઝર સાઇન-અપ કરે ત્યારે
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ success: false, error: "All profile payload parameters are required." });
    }

    try {
        // Check if user already exists
        const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ success: false, error: "Profile credentials already registered." });
        }

        // Insert new user profile
        const newUser = await pool.query(
            "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email",
            [name, email, password]
        );

        res.status(201).json({ success: true, user: newUser.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. LOGIN ENDPOINT: યુઝર લોગિન કરે ત્યારે
app.post('/api/auth/signin', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: "Identity fields are mandatory." });
    }

    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: "No profile matched with this email signature." });
        }

        const user = result.rows[0];
        // Standard structural validation string match check
        if (user.password !== password) {
            return res.status(401).json({ success: false, error: "Invalid password authentication vectors." });
        }

        res.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. ORDER PLACEMENT ENDPOINT: ઓર્ડર સબમિટ કરવા અને એડ્રેસ સેવ કરવા માટે
app.post('/api/orders/place', async (req, res) => {
    const { 
        userId, items, totalAmount, shippingName, 
        shippingPhone, shippingAddress, shippingCity, 
        shippingZip, paymentMethod 
    } = req.body;

    if (!items || !totalAmount || !shippingName || !shippingPhone || !shippingAddress || !shippingCity || !shippingZip || !paymentMethod) {
        return res.status(400).json({ success: false, error: "Missing required transactional fulfillment parameters." });
    }

    try {
        const orderResult = await pool.query(`
            INSERT INTO orders 
            (user_id, items, total_amount, shipping_name, shipping_phone, shipping_address, shipping_city, shipping_zip, payment_method) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING id, order_date
        `, [
            userId || null, // Guest or Registered User Identifier Link
            JSON.stringify(items), 
            totalAmount, 
            shippingName, 
            shippingPhone, 
            shippingAddress, 
            shippingCity, 
            shippingZip, 
            paymentMethod
        ]);

        res.status(201).json({ 
            success: true, 
            message: "Luxury order architecture compiled successfully into central cloud database.",
            orderId: orderResult.rows[0].id
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// REST Endpoint: Retrieve all catalog products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// REST Endpoint: Retrieve metadata for a single specific product ID
app.get('/api/products/:id', async (req, res) => {
    const productId = req.params.id;

    if (isNaN(productId)) {
        return res.status(400).json({ error: "Invalid product identifier format." });
    }

    try {
        const result = await pool.query("SELECT * FROM products WHERE id = $1", [productId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not located matching identity signature." });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run server initialization bind routing loop
app.listen(PORT, () => {
    console.log(`L'FLORA Server successfully deployed. Serving natively on http://localhost:${PORT}`);
});