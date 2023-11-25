require("dotenv").config();
const express = require('express');
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 4000;


app.use(express.static("public"));
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.lsgnws9.mongodb.net/?retryWrites=true&w=majority`;




// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send("unauthorization access")
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "forbidden access" })
        }
        req.decoded = decoded;
        next()

    })
}

async function run() {
    try {
        const modalCollection = client.db('modalCollections').collection("modalData");
        const bookingCollection = client.db('modalCollections').collection("booking");
        const userCollections = client.db('modalCollections').collection("user");
        const doctorsCollections = client.db('modalCollections').collection("doctors");
        const paymentsCollections = client.db('modalCollections').collection("payments");

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await userCollections.findOne(query);
            if (user?.role !== "admin") {
                return res.status(403).send({ message: "forbidden access !" })
            }
            next()
        }

        // Connect the client to the server	(optional starting in v4.7)
        client.connect();
        // be carefull to code 
        app.get('/appoinment', async (req, res) => {
            const query = {}
            const date = req.query.date;
            const result = await modalCollection.find(query).toArray();
            const bookingQuery = { appoinmentDate: date }
            const alreadyBooking = await bookingCollection.find(bookingQuery).toArray();
            result.forEach(option => {
                const optionBooked = alreadyBooking.filter(book => book.tretment === option.name);
                const slotBooked = optionBooked.map(booking => booking.slot);
                const reamingSlot = option.slots.filter(slot => !slotBooked.includes(slot))

                option.slots = reamingSlot;
            })


            res.send(result);
        })
        app.get('/appoinmentspecialist', async (req, res) => {
            const query = {};
            const result = await modalCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })
        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                res.status(403).send({ message: "forbidden access !" })

            }

            const query = { email: email }

            const result = await bookingCollection.find(query).toArray()
            res.send(result);

        })


        // if (user) {
        //     const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
        //     return res.send({ accessToken: token })
        // }
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }

            const user = await userCollections.findOne(query);
            console.log(user);

            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: "1h" })
                return res.send({ accessToken: token })
            }

            res.status(403).send({ accessToken: "" })
        })
        app.get('/users', async (req, res) => {
            const query = {};
            const result = await userCollections.find(query).toArray();
            res.send(result);
        })
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollections.findOne(query);
            res.send({ isAdmin: user?.role === "admin" })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await userCollections.insertOne(user);
            res.send(result);
        })

        app.post('/bookings', async (req, res) => {
            const book = req.body;
            const query = {
                appoinmentDate: book.appoinmentDate,
                email: book.email,
                tretment: book.tretment
            }
            const alreadyBook = await bookingCollection.find(query).toArray()
            if (alreadyBook.length) {
                const message = `You already have an appoinemt book on ${book.appoinmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const cursor = await bookingCollection.insertOne(book);
            res.send(cursor);
        })


        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await userCollections.updateOne(filter, updatedDoc, options);
            res.send(result);

        })

        // doctors site create
        app.get('/doctors', async (req, res) => {
            const query = {}
            const result = await doctorsCollections.find(query).toArray();
            res.send(result)
        })
        app.post('/doctors', async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollections.insertOne(doctor);
            res.send(result);
        })

        app.delete('/doctors/:id', async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const result = await doctorsCollections.deleteOne(filter);
            res.send(result);
        })

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await bookingCollection.findOne(filter)
            res.send(result)
        })

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                "payment_method_types": [
                    "card"
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });

        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollections.insertOne(payment);
            const id = payment.bookingId
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    paid: true,
                    tranjectionId: payment.tranjectionId
                }
            }
            const updateResult = await bookingCollection.updateOne(filter, updateDoc)
            res.send(result);
        })

        // tramporary code  add price 

        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await modalCollection.updateMany(filter, updatedDoc, options)
        //     res.send(result)
        // })








        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

    }
}
run().catch(console.dir);




app.get('/', async (req, res) => {
    res.send("server is on ")
})
app.listen(port, () => {
    console.log(`server is on by ${port} `)
})