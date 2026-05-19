/**
 * =========================================================================
 * NIMMACART ALPINE JS CORE ENGINE
 * =========================================================================
 * Application State and API Management Layer
 */
function nimmacart() {
    return {
        // --- UI Visibility States ---
        darkMode: false,
        showAdmin: false,
        showCart: false,
        showLogin: false,
        showWishlist: false,
        showCheckout: false,
        errorShake: false,

        // --- Store Filters & Core Collections ---
        activeCat: 'All Products',
        searchQuery: '',
        categories: ['All Products', 'Electronics', 'Fashion', 'Home', 'Gadgets'],
        products: [],
        cart: [],
        wishlist: [],

        // --- Transaction Engine States ---
        checkoutStep: 1,
        paymentMethod: 'UPI',
        shippingAddress: '',
        toasts: [],

        // --- Identity Management States ---
        isLoggedIn: false,
        currentUser: { email: '' },
        userForm: { email: '', password: '' },
        authMode: 'login', // Options: 'login', 'signup', 'forgot', 'reset', '2fa'
        resetToken: '',
        pendingTwoFactorEmail: '',
        twoFactorCode: '',
        newP: { name: '', price: '', category: 'Electronics', image: '', rating: '' },
        showPassword: false, // Toggle for password visibility
        showConfirmPassword: false, // Toggle for confirm password visibility
        backendOnline: true, // tracks backend reachability

        /**
         * Lifecycle Hook Initialization
         */
        async init() {
            await this.checkBackend();
            if (!this.backendOnline) {
                this.triggerError('Backend unreachable. Check laptop server or network.');
            }

            if (this.backendOnline) await this.fetchProducts();

            this.restoreSession();

            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            if (token) {
                this.resetToken = token;
                this.authMode = 'reset';
                this.showLogin = true;
            }
        },

        /**
         * Check whether backend API is reachable from this client (mobile/laptop)
         */
        /**
         * Check whether backend API is reachable from this client (mobile/laptop)
         */
        async checkBackend(timeout = 10000) { // Increased to 10 seconds for stable mobile wakeups
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeout);
                const res = await fetch(`${this.apiUrl}/products`, { method: 'GET', signal: controller.signal });
                clearTimeout(id);
                this.backendOnline = res && res.ok;
                return this.backendOnline;
            } catch (e) {
                this.backendOnline = false;
                return false;
            }
        },

        /**
         * Restore user session from localStorage
         */
        async restoreSession() {
            const storedEmail = localStorage.getItem('nimmacartUserEmail');
            if (storedEmail) {
                this.isLoggedIn = true;
                this.currentUser = { email: storedEmail };
                await this.fetchCart();
                await this.fetchWishlist();
            }
        },


        get apiUrl() {
            const host = window.location.hostname || 'localhost';
            const protocol = window.location.protocol;
            const port = window.location.port;

            // If running locally via VS Code Live Server (ports 5500/5501) or standard localhost
            if (host === 'localhost' || host === '127.0.0.1') {
                return `http://localhost:3000`;
            }

            // If running live on Render, use the current domain name automatically
            return `${protocol}//${host}`;
        },

        // =========================================================================
        // PRODUCT DISCOVERY & INGESTION METHODS
        // =========================================================================

        /**
         * Fetches all available inventory items from the database
         */
        async fetchProducts() {
            try {
                const res = await fetch(`${this.apiUrl}/products`);
                this.products = await res.json();
            } catch (e) {
                console.error("Fetch products error:", e);
            }
        },

        /**
         * Dispatches a newly created catalog items payload to store inventory
         */
        async addProduct() {
            if (!this.newP.name || !this.newP.price || !this.newP.image) {
                this.notify("Please fill all fields", "error");
                return;
            }

            try {
                const res = await fetch(`${this.apiUrl}/products`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.newP)
                });

                if (res.ok) {
                    this.showAdmin = false;
                    this.newP = { name: '', price: '', category: 'Electronics', image: '', rating: '' };
                    await this.fetchProducts();
                    this.notify("Product added successfully!");
                } else {
                    this.notify("Failed to add product", "error");
                }
            } catch (e) {
                this.notify("Server error", "error");
            }
        },

        // =========================================================================
        // USER AUTHENTICATION & ACCESS CONTROL METHODS
        // =========================================================================

        /**
         * Validates credentials and attempts user login
         */
        async handleLogin() {
            const emailTemplate = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.com$/;
            const passwordTemplate = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,15}$/;

            if (!this.userForm.email || !this.userForm.password) {
                this.triggerError("Please fill all fields");
                return;
            }
            if (!emailTemplate.test(this.userForm.email)) {
                this.triggerError("Email must be a valid address ending in .com");
                return;
            }
            if (!passwordTemplate.test(this.userForm.password)) {
                this.triggerError("Password must be 6-15 characters and include uppercase, lowercase, numbers, and symbols");
                return;
            }

            try {
                // Inform the mobile user that the system is processing their request
                this.notify("Verifying credentials... please wait.", "success");

                const res = await fetch(`${this.apiUrl}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: this.userForm.email, password: this.userForm.password })
                });
                const data = await res.json();

                if (!res.ok) {
                    this.triggerError(data.message || 'Invalid credentials');
                    return;
                }

                if (data.needs2fa) {
                    this.authMode = '2fa';
                    this.pendingTwoFactorEmail = this.userForm.email;
                    this.userForm.password = '';
                    this.notify('2FA code successfully dispatched to your inbox!');
                    return;
                }

                this.isLoggedIn = true;
                this.currentUser = { email: this.userForm.email };
                localStorage.setItem('nimmacartUserEmail', this.userForm.email);
                this.showLogin = false;
                this.userForm = { email: '', password: '' };
                await this.fetchCart();
                await this.fetchWishlist();
                this.notify('Welcome back, ' + this.currentUser.email + '!');
            } catch (error) {
                this.triggerError('Server is offline');
            }
        },

        async handleVerifyTwoFactor() {
            if (!this.pendingTwoFactorEmail || !this.twoFactorCode) {
                this.triggerError("Enter the 2FA code sent to your email.");
                return;
            }

            try {
                const res = await fetch(`${this.apiUrl}/verify-2fa`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: this.pendingTwoFactorEmail, code: this.twoFactorCode })
                });

                const data = await res.json();

                if (res.ok) {
                    this.isLoggedIn = true;
                    this.currentUser = data.user;
                    this.showLogin = false;
                    this.authMode = 'login';
                    this.pendingTwoFactorEmail = '';
                    this.twoFactorCode = '';
                    await this.fetchCart();
                    await this.fetchWishlist();
                    this.notify("Two-factor authentication verified. Welcome back!");
                } else {
                    this.triggerError(data.message || "Invalid 2FA code");
                }
            } catch (error) {
                this.triggerError("Unable to verify 2FA");
            }
        },

        async handleForgotPassword() {
            if (!this.userForm.email) {
                this.triggerError("Please enter your email address");
                return;
            }
            try {
                const res = await fetch(`${this.apiUrl}/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: this.userForm.email })
                });
                const data = await res.json();
                if (!res.ok) {
                    this.triggerError(data.message || "Unable to send reset email");
                    return;
                }
                this.notify(data.message || "Password reset link sent. Check your email.");
                this.authMode = 'login';
                this.userForm.password = '';
            } catch (e) {
                this.triggerError("Connection failed");
            }
        },

        async handleResetPassword() {
            if (!this.userForm.password) {
                this.triggerError("Please enter a new password");
                return;
            }
            if (!this.resetToken) {
                this.triggerError("Reset token missing. Open the link from your email again.");
                return;
            }
            try {
                const res = await fetch(`${this.apiUrl}/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: this.resetToken, newPassword: this.userForm.password })
                });
                const data = await res.json();
                if (!res.ok) {
                    this.triggerError(data.message || "Reset operation failed");
                    return;
                }
                this.notify(data.message || "Password reset successfully. Please login with your new password.");
                this.userForm = { email: '', password: '' };
                this.authMode = 'login';
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                this.triggerError("Reset operation failed");
            }
        },

        /**
         * Validates registration info and registers a new profile record
         */
        async handleSignup() {
            const emailTemplate = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.com$/;
            const passwordTemplate = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,15}$/;

            if (!this.userForm.email || !this.userForm.password) {
                this.triggerError("Please fill all fields");
                return;
            }
            if (!emailTemplate.test(this.userForm.email)) {
                this.triggerError("Email must be a valid address ending in .com");
                return;
            }
            if (!passwordTemplate.test(this.userForm.password)) {
                this.triggerError("Password must be 6-15 characters and include uppercase, lowercase, numbers, and symbols");
                return;
            }

            try {
                const res = await fetch(`${this.apiUrl}/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: this.userForm.email, password: this.userForm.password })
                });
                const data = await res.json();
                if (!res.ok) {
                    this.triggerError(data.message || "This email is already registered!");
                    return;
                }

                this.notify(data.message || "Account created successfully! Please login.");
                this.userForm = { email: '', password: '' };
                this.authMode = 'login';
            } catch (error) {
                this.triggerError("Connection failed");
            }
        },

        /**
         * Discards credentials and clears user data states from memory
         */
        async logout() {
            this.isLoggedIn = false;
            this.cart = [];
            this.wishlist = [];
            this.currentUser = { email: '' };
            localStorage.removeItem('nimmacartUserEmail');
            this.notify("Logged out successfully", "error");
        },

        // =========================================================================
        // SHOPPING CART MANAGEMENT METHODS
        // =========================================================================

        /**
         * Retreives user session's synchronous cart collection data from server
         */
        async fetchCart() {
            if (!this.isLoggedIn) return;
            try {
                const res = await fetch(`${this.apiUrl}/cart/${this.currentUser.email}`);
                const data = await res.json();
                
                this.cart = Array.isArray(data) ? data : (data.rows || data);
            } catch (e) {
                console.error("Error updating cart badge view:", e);
            }
        },

        /**
         * Appends an operational target catalog item to user shopping bag collection
         */
        async addToCart(product) {
            if (!this.isLoggedIn) return this.showLogin = true;
            await fetch(`${this.apiUrl}/cart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email, productId: product.id })
            });
            await this.fetchCart();
            this.notify("Added to bag");
        },

        /**
         * Removes target contextual records out of server-persisted shopping instances
         */
        async removeFromCart(id) {
            await fetch(`${this.apiUrl}/cart/${id}`, { method: 'DELETE' });
            await this.fetchCart();
        },

        // =========================================================================
        // WISHLIST PROCESSING MODULES
        // =========================================================================

        /**
         * Fetches saved tracking wishlist items assigned to active accounts
         */
        async fetchWishlist() {
            if (!this.isLoggedIn) return;
            try {
                const res = await fetch(`${this.apiUrl}/wishlist/${this.currentUser.email}`);
                const data = await res.json();
                
                this.wishlist = Array.isArray(data) ? data : (data.rows || data);
            } catch (e) {
                console.error("Error updating wishlist view state:", e);
            }
        },

        /**
         * Boolean identifier evaluating catalog items relationship metrics
         */
        isInWishlist(id) {
            return this.wishlist.some(i => i.id === id);
        },

        /**
         * Alternates presence profiles for an identical inventory entity inside databases
         */
        async toggleWishlist(product) {
            if (!this.isLoggedIn) return this.showLogin = true;
            const exists = this.isInWishlist(product.id);
            try{
                if (exists) {
                    await fetch(`${this.apiUrl}/wishlist/${this.currentUser.email}/${product.id}`, { method: 'DELETE' });
                    this.notify("Removed from wishlist", "error");
                } else {
                    await fetch(`${this.apiUrl}/wishlist`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: this.currentUser.email, productId: product.id, productName: product.name })
                    });
                    this.notify("Saved to wishlist");
                }
                await this.fetchWishlist();
            } catch (err) {
                this.notify("Wishlist synchronization failed", "error");
            }
        },

        /**
         * Shifts a product from the wishlist collection directly over to the shopping cart
         */
        async moveFromWishToCart(item) {
            await this.addToCart(item);
            await this.toggleWishlist(item);
        },

        // =========================================================================
        // WIZARD TRANSACTIONAL CHECKOUT MODULES
        // =========================================================================

        /**
         * Validates current shipment data metrics to step engine parameters forward
         */
        goToPayment() {
            if (!this.shippingAddress.trim()) {
                this.notify("Please enter a valid shipping destination address", "error");
                return;
            }
            this.checkoutStep = 2;
        },

        /**
         * Packages explicit checkout parameters to complete processing operations
         */
        async processCheckout() {
            try {
                const res = await fetch(`${this.apiUrl}/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: this.currentUser.email,
                        cartItems: this.cart,
                        totalAmount: this.totalPrice,
                        shippingAddress: this.shippingAddress,
                        paymentMethod: this.paymentMethod
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    this.notify(data.message);
                    this.cart = []; 
                    this.shippingAddress = '';
                    this.paymentMethod = 'UPI';
                    this.checkoutStep = 1;
                    this.showCheckout = false;
                } else {
                    this.notify(data.message, "error");
                }
            } catch (e) {
                this.notify("Transaction pipeline failed connectivity tracking execution error", "error");
            }
        },

        // =========================================================================
        // NOTIFICATION SYSTEM & UTILITY MACROS
        // =========================================================================

        /**
         * Appends toast message nodes into state queue cycles before cleaning timeouts
         */
        notify(message, type = 'success') {
            const id = Date.now();
            this.toasts.push({ id, message, type });
            setTimeout(() => this.toasts = this.toasts.filter(t => t.id !== id), 3000);
        },

        /**
         * Dispatches immediate alert warnings alongside trigger animation properties
         */
        triggerError(msg) {
            this.notify(msg, "error");
            this.errorShake = true;
            setTimeout(() => { this.errorShake = false; }, 400);
        },

        // =========================================================================
        // COMPUTED REACTIVE PROPERTIES (GETTERS)
        // =========================================================================

        /**
         * Filters the master dataset utilizing selected categorical indices and query matches
         */
        get filteredProducts() {
            return this.products.filter(p => {
                return (this.activeCat === 'All Products' || p.category === this.activeCat) &&
                    p.name.toLowerCase().includes(this.searchQuery.toLowerCase());
            });
        },

        /**
         * Aggregates item pricing metrics inside active cart arrays
         */
        get totalPrice() {
            return this.cart.reduce((s, i) => s + Number(i.price), 0);
        }
    }
}