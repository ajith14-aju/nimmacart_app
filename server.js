const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Resend } = require('resend');
const { Pool } = require('pg');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 1. DATABASE CONNECTIVITY LAYER SUPABASE POSTGRES
// =========================================================================

const db = new Pool({
    connectionString: "postgresql://postgres.zkwdoyvvdmajvlhnppej:Nimmacart%2414@aws-1-ap-south-1.pooler.supabase.com:6543/postgres",
    ssl: {
        rejectUnauthorized: false // Required for secure cloud connections to Supabase
    }
});

function getLocalNetworkAddress() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return null;
}

function buildFrontendOrigin(req) {
    const isLocalhost = host => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const origin = req.headers.origin || null;
    if (origin) {
        try {
            const parsed = new URL(origin);
            if (!isLocalhost(parsed.hostname)) return parsed.origin;
        } catch (e) {}
    }

    const referer = req.headers.referer || null;
    if (referer) {
        try {
            const parsed = new URL(referer);
            if (!isLocalhost(parsed.hostname)) return parsed.origin;
        } catch (e) {}
    }

    const hostHeader = req.headers.host || null;
    if (hostHeader && !isLocalhost(hostHeader.split(':')[0])) {
        return `http://${hostHeader}`;
    }

    const localIp = getLocalNetworkAddress();
    if (localIp) {
        return `http://${localIp}:${DEFAULT_PORT}`;
    }

    return `http://127.0.0.1:${DEFAULT_PORT}`;
}


db.connect(err => {
    if (err) {
        console.error("Supabase Connection Failed:", err.message);
        return;
    }
    console.log("Connected to Supabase (PostgreSQL) Database successfully");

    const schemaSql = `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_code TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_expires TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT true;
    `;

    db.query(schemaSql, updateErr => {
        if (updateErr) {
            console.error("Failed to ensure auth schema columns:", updateErr.message);
        } else {
            console.log("Auth schema columns verified in users table.");
        }
    });
});

// =========================================================================
// 2. TRANSACTIONAL EMAIL ARCHITECTURE (NODEMAILER)
// =========================================================================



// Initialize Resend with your token directly
const resend = new Resend('re_jggqTDhv_P2nAbpTdAyH48nawQYn2vXDg');

// =========================================================================
// 3. CORE CATALOG MANIPULATION ROUTES (PRODUCTS)
// =========================================================================

/**
 * GET: Retrieve full active inventory datasets
 */
app.get('/products', (req, res) => {
    db.query("SELECT * FROM products", (err, result) => {
        if (err) return res.status(500).send(err);
        res.send(result.rows);
    });
});

/**
 * POST: Inject new production records into store catalog definitions
 */
app.post('/products', (req, res) => {
    const { name, price, category, image, rating } = req.body;
    const productRating = rating || 4.0; 

    const sql = "INSERT INTO products (name, price, category, image, rating) VALUES ($1, $2, $3, $4, $5) RETURNING id";
    
    db.query(sql, [name, price, category, image, productRating], (err, result) => {
        if (err) return res.status(500).send(err);
        res.send({ id: result.rows[0].id, ...req.body, rating: productRating });
    });
});

/**
 * DELETE: Erase a tracking catalog entity instance out of database bounds
 */
app.delete('/products/:id', (req, res) => {
    const productId = req.params.id;
    const sql = "DELETE FROM products WHERE id = $1";
    
    db.query(sql, [productId], (err, result) => {
        if (err) {
            console.error("Delete Error:", err);
            return res.status(500).json({ message: "Database error" });
        }
        res.json({ message: "Product deleted successfully" });
    });
});

// =========================================================================
// 4. CUSTOMER SHOPPING BAG INVENTORY ROUTING (CART)
// =========================================================================

/**
 * GET: Fetch account contextual shopping entities alongside structural inner joins
 */
app.get('/cart/:email', (req, res) => {
    const email = req.params.email;
    const sql = `
        SELECT cart.id AS cart_item_id, products.id, products.name, products.price, products.image 
        FROM cart 
        JOIN products ON cart.product_id = products.id 
        WHERE cart.user_email = $1`;
    
    db.query(sql, [email], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

/**
 * POST: Map target relational records inside account cart tracking sheets
 */
app.post('/cart', (req, res) => {
    const { email, productId } = req.body;
    if (!email) return res.status(401).json({ message: "Login required" });

    const sql = "INSERT INTO cart (user_email, product_id) VALUES ($1, $2)";
    db.query(sql, [email, productId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Added to cart" });
    });
});

/**
 * DELETE: Drops a single item instance record from shopping bag reference sets
 */
app.delete('/cart/:cartItemId', (req, res) => {
    const sql = "DELETE FROM cart WHERE id = $1";

    db.query(sql, [req.params.cartItemId], (err, result) => {
        if (err) {
            console.error("Cart Error:", err);
            return res.status(500).json({ message: "Failed to remove item from cart" });
        }
        res.json({
            message: "Item removed successfully",
            affectedRows: result.affectedRows
        });
    });
});

/**
 * DELETE [ADMIN]: Flush complete cart tables bound to unique targets
 */
app.delete('/admin/clear-cart/:email', (req, res) => {
    const targetEmail = req.params.email;
    const sql = "DELETE FROM cart WHERE user_email = $1";
    
    db.query(sql, [targetEmail], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ 
            message: `Successfully cleared cart records for ${targetEmail}`,
            itemsRemoved: result.affectedRows 
        });
    });
});

// =========================================================================
// 5. SAVED WISH-LIST RECORD KEEPING LAYER
// =========================================================================

/**
 * GET: Retrieve relational user records tagged on verification wish sheets
 */
app.get('/wishlist/:email', (req, res) => {
    const sql = `
        SELECT wishlist.id AS wishlist_id, products.id, products.name, products.price, products.image 
        FROM wishlist 
        JOIN products ON wishlist.product_id = products.id 
        WHERE wishlist.user_email = $1`;

    db.query(sql, [req.params.email], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

/**
 * POST: Bind distinct catalogs into specified personal targets lists
 */
app.post('/wishlist', (req, res) => {
    const { email, productId, productName } = req.body;
    if (!email) return res.status(401).json({ message: "Login required" });
    if (!productName) return res.status(400).json({ message: "Product name is required" });

    const sql = "INSERT INTO wishlist (user_email, product_id, product_name) VALUES ($1, $2, $3)";
    db.query(sql, [email, productId, productName], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Failed to add to wishlist" });
        }
        res.json({ message: "Added to Wishlist successfully" });
    });
});

/**
 * DELETE: Drop an associative wishlist record using compound lookup fields
 */
app.delete('/wishlist/:email/:productId', (req, res) => {
    const sql = "DELETE FROM wishlist WHERE user_email = $1 AND product_id = $2";
    db.query(sql, [req.params.email, req.params.productId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Removed" });
    });
});

// =========================================================================
// 6. TWO-STEP ORDER CONSOLIDATION AND INVOICING PIPELINE
// =========================================================================

/**
 * POST: Create transactional receipt details, dispatch mail summaries, and drop related carts
 */
app.post('/checkout', (req, res) => {
    const { email, cartItems, totalAmount, shippingAddress, paymentMethod } = req.body;
    
    if (!email) return res.status(401).json({ message: "Unauthorized login required" });
    if (!cartItems || cartItems.length === 0) return res.status(400).json({ message: "No checkout products tracked" });
    if (!shippingAddress) return res.status(400).json({ message: "Missing required shipping data entries" });

    const orderSummary = cartItems.map(item => `- ${item.name}: ₹${item.price}`).join('\n');
    
    resend.emails.send({
        from: 'Nimmacart <onboarding@resend.dev>',
        to: email,
        subject: 'Order Successfully Placed & Verified! 💎',
        text: `Hello,\n\nYour invoice order calculation statement has processed successfully.\n\nSummary Content:\n${orderSummary}\n\nAggregate Pricing Settlement: ₹${totalAmount}\nPayment Method Choice: [${paymentMethod}]\n\nLogistic Destination Routing:\n${shippingAddress}\n\nThank you for choosing Nimmacart!`
    }).catch(err => console.error("Billing email error:", err.message));

    const orderSql = "INSERT INTO orders (user_email, total_amount, shipping_address, payment_method) VALUES ($1, $2, $3, $4) RETURNING id";
    db.query(orderSql, [email, totalAmount, shippingAddress, paymentMethod], (orderErr, orderResult) => {
        if (orderErr) return res.status(500).json({ message: "Failed to log order records" });

        const wipeCartSql = "DELETE FROM cart WHERE user_email = $1";
        db.query(wipeCartSql, [email], (err, result) => {
            if (err) return res.status(500).json({ message: "Database transactional flush error" });
            res.json({ message: `Success! Order placed via ${paymentMethod}. Confirmation sent.` });
        });
    });
});

// =========================================================================
// 7. ACCOUNT INITIALIZATION & SECURITY PIPELINES (AUTH)
// =========================================================================

/**
 * POST: Create explicit credentials mapping row entries
 */
app.post('/signup', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Fields cannot be empty" });

    const sql = "INSERT INTO users (email, password, two_fa_enabled) VALUES ($1, $2, true)";
    db.query(sql, [email, password], (err, result) => {
        if (err){
            console.error("Signup error log:", err.message);
            return res.status(500).json({ message: "User already exists" });
        }
        res.json({ message: "Account created! You can now login." });
    });
});

/**
 * POST: Evaluate profiles data maps and dispatch two-factor verification codes
 */
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    const sql = "SELECT email, id, two_fa_enabled FROM users WHERE email = $1 AND password = $2";
    db.query(sql, [email, password], (err, dbResult) => {
        if (err || !dbResult || !dbResult.rows || dbResult.rows.length === 0) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const user = dbResult.rows[0];
        const oneTimeCode = crypto.randomInt(100000, 1000000).toString();
        
        // This creates a standard ISO timestamp string that database engines read natively as UTC
        const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        const updateSql = "UPDATE users SET two_fa_code = $1, two_fa_expires = $2 WHERE email = $3";
        db.query(updateSql, [oneTimeCode, expiry, email], updateErr => {
            if (updateErr) {
                console.error("2FA save error:", updateErr.message);
                return res.status(500).json({ message: "Failed to start two-factor authentication" });
            }

            resend.emails.send({
                from: 'Nimmacart Security <onboarding@resend.dev>',
                to: user.email,
                subject: 'Your Nimmacart Two-Factor Authentication Code',
                text: `Your Nimmacart verification code is: ${oneTimeCode}\n\nEnter this code on the website within 10 minutes to complete login.`
            }).then(() => console.log(`Sent 2FA code to ${user.email}`))
              .catch(err => console.error("2FA email send error:", err.message));

            res.json({ needs2fa: true, message: "A 2FA code was sent to your email." });
        });
    });
});

app.post('/verify-2fa', (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: "Email and 2FA code are required" });

    const sql = "SELECT id, email FROM users WHERE email = $1 AND two_fa_code = $2 AND two_fa_expires > (NOW() AT TIME ZONE 'utc')";
    db.query(sql, [email, code], (err, result) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!result || !result.rows || result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid or expired 2FA code" });
        }

        const user = result.rows[0];
        const clearSql = "UPDATE users SET two_fa_code = NULL, two_fa_expires = NULL WHERE email = $1";
        db.query(clearSql, [email], clearErr => {
            if (clearErr) console.error("Failed to clear 2FA code:", clearErr.message);
        });

        const loginTime = new Date().toLocaleString();
        const loginAlertMail = {
            from: '"Nimmacart Security" <ajithaju7090@gmail.com>',
            to: user.email,
            subject: 'Security Alert: Login Verified 🔐',
            text: `Hello,\n\nYour Nimmacart login was verified successfully at ${loginTime}.\n\nIf this was not you, please reset your password immediately.`
        };

        transporter.sendMail(loginAlertMail, err => {
            if (err) {
                console.error("Login alert email error:", err.message);
            }
        });

        res.json({ message: "Login successful", user });
    });
});

// 1. FORGOT PASSWORD: Generate token and email it to the user
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Check if user exists
    db.query("SELECT email FROM users WHERE email = $1", [email], (err, result) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!result || result.rows.length === 0) {
            // Security Best Practice: Don't explicitly reveal that the email doesn't exist
            return res.json({ message: "If that email exists, a reset link has been sent." });
        }

        // Generate a secure random token and set expiry to 1 hour from now
        const token = crypto.randomBytes(20).toString('hex');
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 1); 

        const updateSql = "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3";
        db.query(updateSql, [token, expiry, email], (updateErr) => {
            if (updateErr) return res.status(500).json({ message: "Failed to process token" });

            // Create the reset link pointing to your frontend page
            const frontendOrigin = buildFrontendOrigin(req).replace(/\/$/, '');
            let frontendPath = '/';
            if (req.headers.referer) {
                try {
                    const parsedReferer = new URL(req.headers.referer);
                    if (parsedReferer.pathname && parsedReferer.pathname !== '' && parsedReferer.pathname !== '/') {
                        frontendPath = parsedReferer.pathname;
                    }
                } catch (e) {
                    // ignore invalid referer URL and use default path
                }
            }
            const resetLink = `${frontendOrigin}${frontendPath}?token=${token}`;

            resend.emails.send({
                from: 'Nimmacart Support <onboarding@resend.dev>',
                to: email,
                subject: 'Password Reset Request 🔑',
                text: `You requested a password reset for your Nimmacart account.\n\nPlease open this link in your browser to reset your password:\n\n${resetLink}`,
                html: `
                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 500px;">
                        <h3>Nimmacart Security</h3>
                        <p>Click the button below to complete your credential modification process:</p>
                        <a href="${resetLink}" target="_blank" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block; margin: 15px 0;">
                            Reset Password
                        </a>
                        <p style="font-size: 11px; color: #94a3b8;">If the button doesn't work, copy-paste this link: <br><a href="${resetLink}" target="_blank" style="color: #2563eb;">${resetLink}</a></p>
                    </div>
                `
            }).catch(mailErr => console.error("Reset email delivery failed:", mailErr.message));

            res.json({ message: "If that email exists, a reset link has been sent." });
        });
    });
});

// 2. RESET PASSWORD: Verify token and update password
app.post('/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    
    // Strict Password Validation Rule matching your signup criteria (6-15 chars, complex symbols)
    const passwordTemplate = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,15}$/;
    
    if (!token || !newPassword) return res.status(400).json({ message: "Missing required fields" });
    if (!passwordTemplate.test(newPassword)) {
        return res.status(400).json({ message: "Password must be 6-15 characters and include uppercase, lowercase, numbers, and symbols" });
    }

    // Look for a user with this active token who hasn't expired yet
    const findSql = "SELECT email FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP";
    db.query(findSql, [token], (err, result) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!result || result.rows.length === 0) {
            return res.status(400).json({ message: "Token is invalid or has expired." });
        }

        const email = result.rows[0].email;

        // Update password and clear out token fields so they can't be reused
        const updateSql = "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE email = $2";
        db.query(updateSql, [newPassword, email], (updateErr) => {
            if (updateErr) return res.status(500).json({ message: "Failed to update password" });
            res.json({ message: "Password updated successfully! You can now login." });
        });
    });
});

// =========================================================================
// 8. BACKEND RUNTIME ACTIVATION LISTENER
// =========================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(port, attempts = 0) {
    const server = app.listen(port, () => {
        console.log(`Nimmacart Backend and frontend running on http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < 3) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is already in use. Trying port ${nextPort} instead...`);
            startServer(nextPort, attempts + 1);
        } else {
            console.error('Failed to start server:', err.message);
            process.exit(1);
        }
    });
}

startServer(DEFAULT_PORT);
