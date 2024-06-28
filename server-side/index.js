const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster2024.kjdp6b2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster2024`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const productsCollection = client
      .db("hossain_Pharma")
      .collection("products");

    const cartCollection = client.db("hossain_Pharma").collection("cart");

    const categoryCollection = client
      .db("hossain_Pharma")
      .collection("category");

    const userCollection = client.db("hossain_Pharma").collection("user");

    const adsCollection = client.db("hossain_Pharma").collection("ads");

    const approvedAdsCollection = client
      .db("hossain_Pharma")
      .collection("approvedAds");

    const paymentCollection = client
      .db("hossain_Pharma")
      .collection("payments");

    const invoiceCollection = client.db("hossain_Pharma").collection("invoice");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifySeller = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSeller = user?.role === "seller";
      if (!isSeller) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.get("/users/seller/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let seller = false;
      if (user) {
        seller = user?.role === "seller";
      }
      res.send({ seller });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.patch(
      "/users/seller/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "seller",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.patch("/users/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "user",
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // Get all latest products
    app.get("/products", async (req, res) => {
      const result = await productsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get(
      "/products/seller/:email",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await productsCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.post("/products", verifyToken, verifySeller, async (req, res) => {
      const item = req.body;
      item.createdAt = new Date();
      const result = await productsCollection.insertOne(item);
      res.send(result);
    });

    app.put(
      "/products/:id/category",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { category, categoryTag } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            category: category,
            categoryTag: categoryTag,
          },
        };
        const result = await productsCollection.updateOne(filter, updateDoc);
        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Product not found or category not updated" });
        }
        res.send({
          message: "Product category updated successfully",
          result,
        });
      }
    );

    // Delete an item from the products by item ID
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    app.delete(
      "/products/seller/:id",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.deleteOne(query);
        res.send(result);
      }
    );

    //Ads
    app.get("/admin/ads", verifyToken, verifyAdmin, async (req, res) => {
      const result = await adsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/seller/ads", async (req, res) => {
      const result = await adsCollection
        .find({ adsStatus: "accepted" })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get(
      "/seller/ads/:email",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await adsCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.get("/approvedAds", verifyToken, async (req, res) => {
      const result = await approvedAdsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.post("/seller/ads", verifyToken, verifySeller, async (req, res) => {
      const item = req.body;
      item.createdAt = new Date();
      const result = await adsCollection.insertOne(item);
      res.send(result);
    });

    // Route to move ad to approvedAdsCollection
    app.post(
      "/seller/ads/approve",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const ad = req.body;
          await approvedAdsCollection.insertOne(ad);
          res.status(201).send({ message: "Ad approved successfully" });
        } catch (error) {
          console.error("Error approving ad:", error);
          res.status(500).send({ message: "Internal server error" });
        }
      }
    );

    app.patch("/seller/ads/accept/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          adsStatus: "accepted",
        },
      };
      const result = await adsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/seller/ads/reject/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          adsStatus: "rejected",
        },
      };
      const result = await adsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete(
      "/seller/ads/:id",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await adsCollection.deleteOne(query);
        res.send(result);
      }
    );

    app.delete("/approvedAds/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await adsCollection.deleteOne(query);
      res.send(result);
    });

    // Get all categories
    app.get("/category", async (req, res) => {
      const result = await categoryCollection.find().toArray();
      res.send(result);
    });

    app.post("/category", verifyToken, verifyAdmin, async (req, res) => {
      const categoryItems = req.body;
      const result = await categoryCollection.insertOne(categoryItems);
      res.send(result);
    });

    app.delete("/category/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await categoryCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Category not found" });
        }
        res.send({ message: "Category deleted successfully", result });
      } catch (error) {
        console.error("Error deleting category:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Get products by category tag
    app.get("/products/category/:categoryTag", async (req, res) => {
      const categoryTag = req.params.categoryTag;
      const query = { categoryTag: categoryTag };
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });

    // Get items in the cart by user email
    app.get("/cart", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // Add an item to the cart
    app.post("/cart", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    // Update quantity of an item in the cart by item ID
    app.patch("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const { quantity } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          quantity: quantity,
        },
      };
      const result = await cartCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "Item not found or quantity not updated" });
      }
      res.send({
        message: "Item quantity updated successfully",
        result,
      });
    });

    // Delete an item from the cart by item ID
    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Delete all items from the cart by user email
    app.delete("/cart/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await cartCollection.deleteMany(query);
      res.send(result);
    });

    //invoice
    app.post("/invoice", async (req, res) => {
      const invoiceDetails = req.body;
      const result = await invoiceCollection.insertMany(invoiceDetails);
      res.send(result);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/payments", async (req, res) => {
      const result = await paymentCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });



    app.post("/payments", async (req, res) => {
      const payment = req.body;
      payment.createdAt = new Date();
      const paymentResult = await paymentCollection.insertOne(payment);

      //  carefully delete each item from the cart
      console.log("payment info", payment);
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await cartCollection.deleteMany(query);
      res.send({ paymentResult, deleteResult });
    });

    app.patch("/payments/accept/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "accepted",
        },
      };
      const result = await paymentCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/payments/reject/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "rejected",
        },
      };
      const result = await paymentCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await userCollection.estimatedDocumentCount();
        const productsItem = await productsCollection.estimatedDocumentCount();
        const orders = await paymentCollection.estimatedDocumentCount();

        const revenueResult = await paymentCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalRevenue: {
                  $sum: "$price",
                },
              },
            },
          ])
          .toArray();
        const revenue =
          revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        const statusResult = await paymentCollection
          .aggregate([
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const statusCounts = {
          pending: 0,
          accepted: 0,
        };

        statusResult.forEach((status) => {
          if (status._id === "pending") {
            statusCounts.pending = status.count;
          } else if (status._id === "accepted") {
            statusCounts.accepted = status.count;
          }
        });

        // Count users based on roles
        const roleCountsResult = await userCollection
          .aggregate([
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const roleCounts = {
          user: 0,
          seller: 0,
          admin: 0,
        };

        roleCountsResult.forEach((role) => {
          if (role._id === "user") {
            roleCounts.user = role.count;
          } else if (role._id === "seller") {
            roleCounts.seller = role.count;
          } else if (role._id === "admin") {
            roleCounts.admin = role.count;
          }
        });

        res.send({
          users,
          productsItem,
          orders,
          revenue,
          statusCounts,
          roleCounts,
        });
      } catch (error) {
        res.status(500).send({ message: "Error retrieving stats", error });
      }
    });


    // using aggregate pipeline
    app.get("/order-stats", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection
        .aggregate([
          {
            $unwind: "$productsIds",
          },
          {
            $lookup: {
              from: "products",
              localField: "productsIds",
              foreignField: "_id",
              as: "productsItems",
            },
          },
          {
            $unwind: "$productsItems",
          },
          {
            $group: {
              _id: "$productsItems.category",
              quantity: { $sum: 1 },
              revenue: { $sum: "$productsItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue: "$revenue",
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } catch (error) {
    console.error(error);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hossain is sitting");
});

app.listen(port, () => {
  console.log(`Hossain is sitting on port ${port}`);
});
