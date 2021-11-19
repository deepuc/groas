//jshint esversion:6
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MemoryStore = require("memorystore")(session);
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");
const dateFormatter = require(__dirname + "/dateFormatter.js");
const sgMail = require("@sendgrid/mail");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");

const app = express();

if (process.env.NODE_ENV == "production") {
  app.use((req, res, next) => {
    if (req.header("x-forwarded-proto") !== "https") {
      res.redirect(`https://${req.header("host")}${req.url}`);
    } else {
      next();
    }
  });
} //redirects all url to https in production

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  express.urlencoded({
    extended: true,
  })
);

const sessionSecret = process.env.SESSION_SECRET;

app.use(
  session({
    cookie: { maxAge: 86400000 },
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
    secret: sessionSecret,
    resave: true,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

const dbPassword = process.env.DB_PASSWORD;

const mongoUserDBConnect = process.env.MONGO_USERDB_CONNECT;

mongoose.connect(mongoUserDBConnect, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
mongoose.set("useCreateIndex", true);
mongoose.set("useFindAndModify", false);

const listingSchema = new mongoose.Schema({
  productName: String,
  productDescription: String,
  productCategory: String,
  productMinimumBid: Number,
  productEndTime: Date,
  //productImage:  BinData,
});

const biddingSchema = new mongoose.Schema({
  userId: String,
  productId: String,
  productBid: Number,
});

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  googleId: String,
  secret: String,
  role: String,
  isVerified: { type: Boolean, default: false },
  listings: [listingSchema],
  biddings: [biddingSchema],
});

const tokenSchema = new mongoose.Schema({
  _userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
  token: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now, expires: 43200 },
});

userSchema.plugin(passportLocalMongoose, { usernameField: "email" });
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);
const Token = new mongoose.model("Token", tokenSchema);

passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/groas",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    function(accessToken, refreshToken, profile, cb) {
      console.log(profile);

      User.findOrCreate(
        {
          email: profile.emails[0].value,
          name: profile.displayName,
          googleId: profile.id,
          role: "USER",
        },
        function(err, user) {
          return cb(err, user);
        }
      );
    }
  )
);

app.locals.accountType;

app.locals.isLoggedIn;

app.locals.userRole;

app.locals.currentDateTime;

app.locals.dateFormatter = dateFormatter;

var today = new Date();

currentDateTime = dateFormatter(today);

app.get("/", function(req, res) {
  if (req.isAuthenticated()) {
    userRole = req.user.role;
    isLoggedIn = true;
    if (userRole == "ADMIN") {
      res.render("admin/home-admin");
    } else if (accountType == "seller") {
      var listings = req.user.listings;
      res.render("seller/home-seller", { listings: listings });
    } else if (accountType == "buyer") {
      User.find({ _id: { $ne: req.user._id } }, "listings", function(
        err,
        docs
      ) {
        if (err) {
          console.log(err);
        } else {
          console.log(docs);
          res.render("buyer/home-buyer", { userDocumentsWithListings: docs });
        }
      });
    } else {
      res.render("account-type");
    }
  } else {
    isLoggedIn = false;
    res.render("home");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/groas",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function(req, res) {
    accountType = null;
    // Successful authentication, redirect to home.
    res.redirect("/");
  }
);

app.get("/about", function(req, res) {
  res.render("about");
});

app.get("/help", function(req, res) {
  res.render("help");
});

app.get("/listings/product/:id", function(req, res) {
  const id = req.params.id;
  console.log(req.params.id);

  if (userRole == "ADMIN") {
    res.render("admin/home-admin");
  } else if (accountType == "seller") {
    var listings = req.user.listings;
    var product;
    for (var i = 0; i < listings.length && product == null; i++) {
      if (id == listings[i]._id) {
        product = listings[i];
      }
    }
    res.render("seller/listing-update-seller", { product: product });
  } else if (accountType == "buyer") {
    User.findOne({ "listings._id": id }, "listings.$", function(
      err,
      foundListingList
    ) {
      if (err) {
        console.log(err);
      } else {
        console.log(foundListingList);

        User.findOne(
          { _id: req.user._id, "biddings.productId": id },
          "biddings.$",
          function(err, foundBiddingList) {
            if (err) {
              console.log(err);
            } else {
              console.log(foundBiddingList);
              res.render("buyer/listing-detail-buyer", {
                foundListingList: foundListingList,
                foundBiddingList: foundBiddingList,
              });
            }
          }
        );
      }
    });
  } else {
    res.render("account-type");
  }
});

//⇊-------------------For only seller-------------------------⇊//
app.get("/create-listing", function(req, res) {
  if (req.isAuthenticated()) {
    console.log(req.user._id);
    User.findById(req.user._id, function(err, foundList) {
      if (err) {
        console.log(err);
      } else {
        res.render("seller/create-listing-seller");
      }
    });
  }
});

app.post("/create-listing/:productId", function(req, res) {
  console.log(req.body);
  const productId = req.params.productId;
  console.log(productId);
  if (productId == "new") {
    if (req.isAuthenticated()) {
      console.log(req.user._id);
      User.findById(req.user._id, function(err, foundList) {
        if (err) {
          console.log(err);
        } else {
          foundList.listings.push(req.body);
          foundList.save();
          res.redirect("/");
        }
      });
    }
  } else {
    if (req.isAuthenticated()) {
      console.log(req.user._id);
      User.updateOne(
        { _id: req.user._id, "listings._id": productId },
        {
          $set: {
            "listings.$": req.body,
          },
        },
        function(err, foundlist) {
          if (err) {
            console.log(err);
          } else {
            res.redirect("/");
          }
        }
      );
    }
  }
});

app.get("/remove-listing/:productId", function(req, res) {
  console.log(req.body);
  const productId = req.params.productId;
  console.log(productId);
  if (req.isAuthenticated()) {
    console.log(req.user._id);
    User.findByIdAndUpdate(
      req.user._id,
      { $pull: { listings: { _id: productId } } },
      function(err, foundlist) {
        if (err) {
          console.log(err);
        } else {
          res.redirect("/");
          //todo: learn AJAX to refresh only some parts of webpage
        }
      }
    );
  }
});

app.get("/listings/product-bidders-list/:id", function(req, res) {
  const id = req.params.id;
  console.log("productId", id);
  if (req.isAuthenticated()) {
    console.log(req.user._id);
    User.findOne(
      { _id: req.user._id, "listings._id": id },
      "listings.$",
      function(err, foundListingList) {
        if (err) {
          console.log(err);
        } else {
          console.log(foundListingList);

          User.find({ "biddings.productId": id }, "biddings.$", function(
            err,
            foundBiddingList
          ) {
            if (err) {
              console.log(err);
            } else {
              console.log(foundBiddingList);
              res.render("seller/bidders-list-seller", {
                listingDetail: foundListingList,
                biddingsDetails: foundBiddingList,
              });
            }
          });
        }
      }
    );
  }
});

//⇈-------------------For only seller-------------------------⇈//

//⇊-------------------For only Buyyer-------------------------⇊//

app.get("/my-bids", function(req, res) {
  if (accountType == "buyer") {
    var biddingDetails = [];
    User.findById(req.user._id, function(err, foundList) {
      if (err) {
        console.log(err);
      } else {
        console.log("foundUserBidsList: ", foundList.biddings);
        var foundUserBidsList = foundList.biddings;
        async function createMyBidsObjects() {
          // creating my bids objects from biddings from user and bidding product id to find specific listing from seller for product name , descriptions, etc and then reapeat the same process for all bids
          for (var i = 0; i < foundUserBidsList.length; i++) {
            console.log(i);

            var foundListingList = await User.findOne(
              { "listings._id": foundUserBidsList[i].productId },
              "listings.$"
            ).exec();
            console.log("foundListingList: ", foundListingList);

            biddingDetail = {
              productName: foundListingList.listings[0].productName,
              productCategory: foundListingList.listings[0].productCategory,
              productDescription:
                foundListingList.listings[0].productDescription,
              productEndTime: foundListingList.listings[0].productEndTime,
              productBid: foundList.biddings[i].productBid,
              productId: foundList.biddings[i].productId,
            };

            console.log("biddingDetail: ", biddingDetail);
            biddingDetails.push(biddingDetail);
          }
        }
        createMyBidsObjects().then((_) => {
          console.log("After createMyBidsObjects() resolved");
          res.render("buyer/my-bids", {
            biddingDetails: biddingDetails,
          });
        });
      }
    });
  } else {
    res.redirect("/");
  }
});

app.post("/create-bid/:id", function(req, res) {
  const id = req.params.id;
  if (accountType == "buyer" && req.isAuthenticated()) {
    console.log(req.body);
    User.findOne({ "listings._id": id }, "listings.$", function(
      err,
      foundList
    ) {
      if (err) {
        console.log(err);
      } else {
        //creating a new bidding object //polish letter with object creater
        var bidding = {
          userId: foundList._id,
          productId: id,
          productBid: req.body.productBid,
          timeOfBid: currentDateTime,
        };
        console.log(bidding);
        console.log(req.user._id);

        User.findOne({ _id: req.user._id, "biddings.productId": id }, function(
          err,
          foundUserList
        ) {
          console.log("foundUserList: ", foundUserList);
          if (err) {
            console.log(err);
          } else if (!foundUserList) {
            console.log("pushed new bid");
            User.findById(req.user._id, function(err, foundUserList) {
              if (err) {
                console.log(err);
              } else {
                foundUserList.biddings.push(bidding);
                foundUserList.save();
                res.redirect("/");
              }
            });
          } else {
            console.log("updated old bid");
            User.updateOne(
              { _id: req.user._id, "biddings.productId": id },
              {
                $set: {
                  "biddings.$": bidding,
                },
              },
              {
                upsert: true,
              },
              function(err, foundlist) {
                if (err) {
                  console.log(err);
                } else {
                  res.redirect("/");
                }
              }
            );
          }
        });
      }
    });
  } else {
    res.redirect("/");
  }
});

//⇈-------------------For only Buyyer-------------------------⇈//

app.get("/login", function(req, res) {
  if (req.isAuthenticated()) {
    res.redirect("/");
  } else {
    isLoggedIn = false;
    res.render("login");
  }
});

app.get("/register", function(req, res) {
  if (req.isAuthenticated()) {
    res.redirect("/");
  } else {
    isLoggedIn = false;
    res.render("register");
  }
});

app.post("/", function(req, res) {
  // console.log(req.body);
  if (req.body.accountType != null) accountType = req.body.accountType;
  res.redirect("/");
});

app.get("/logout", function(req, res) {
  req.logout();
  accountType = null;
  res.redirect("/");
});

app.post("/register", function(req, res) {
  User.register(
    { email: req.body.email, name: req.body.name, role: "USER" },
    req.body.password,
    function(err) {
      if (err) {
        console.log(err);
        res.redirect("/register");
      } else {
        passport.authenticate("local")(req, res, function() {
          // Create a verification token for this user
          var token = new Token({
            _userId: req.user._id,
            token: crypto.randomBytes(16).toString("hex"),
          });

          // Save the verification token
          token.save(function(err) {
            if (err) {
              console.log("msg: ", err);
            }

            // Send the email using sendgrid Web API or SMTP Relay
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
              to: req.body.email, // Change to your recipient
              from: "deepanshuc2001@gmail.com", // Change to your verified sender
              subject: "Account Verification Token",
              text:
                "Hello,\n\n" +
                "Please verify your account by clicking the link: \n" +
                "http://" +
                req.headers.host +
                "/confirmation/" +
                token.token,
              // html: "<strong>and easy to do anywhere, even with Node.js</strong>",
            };
            sgMail
              .send(msg)
              .then(() => {
                console.log("Email sent");

                res.redirect("/verification-status/pending");
              })
              .catch((error) => {
                console.error(error);
              });
          });

          // accountType = null;
          // res.redirect("/");
        });
      }
    }
  );
});

app.get("/verification-status/:status", function(req, res) {
  accountType = null;
  isLoggedIn = false;

  if (req.params.status == "pending") {
    res.render("user-verification/user-verification-pending");
  } else if (req.params.status == "already-verified") {
    res.render("user-verification/verified", { msg: "Already verified" });
  } else if (req.params.status == "verified") {
    res.render("user-verification/verified", { msg: "Verified" });
  }
});

app.get("/confirmation/:token", function(req, res) {
  const token = req.params.token;
  isLoggedIn = false;

  Token.findOne({ token: token }, function(err, tokenDocument) {
    if (err) {
      console.log(err);
    } else if (!tokenDocument) {
      console.log(
        "We were unable to find this token. Your token may have expired."
      );
      // tell user that this token is not found and might have expired so redner a page with this message and a button which leads to resend token page
      res.render("user-verification/token-not-exist");
    } else {
      res.render("user-verification/user-confirmation", { token: token });
    }
  });
});

app.post(
  "/confirmation/:token",
  [
    body("email", "Email is not valid")
      .exists()
      .trim()
      .normalizeEmail()
      .isEmail(),
  ],
  function(req, res) {
    Token.findOne({ token: req.params.token }, function(err, tokenDocument) {
      if (err) {
        console.log(err);
      } else {
        User.findOne(
          { _id: tokenDocument._userId, email: req.body.email },
          function(err, userDocument) {
            console.log("userDocument : ", userDocument);
            if (err) {
              console.log(err);
            } else if (!userDocument) {
              console.log(
                "This token is not registered with your provided email. "
              );

              const result = validationResult(req);
              const alerts = [];
              console.log(result);
              var errors = result.errors;
              for (var i = 0; i < errors.length; i++) {
                alerts.push(errors[i].msg);
                console.log("error msgs: ", errors[i].msg);
              }

              alerts.push(
                "This token is not registered with your provided email."
              );

              res.render("user-verification/user-confirmation", {
                token: req.params.token,
                alerts: alerts,
              });

              // keep on the same page and ask to re enter correct email for this token
            } else if (userDocument.isVerified) {
              console.log("This user has already been verified.");

              res.redirect("/verification-status/already-verified");

              // in this case redirect user to already verified page
            } else {
              userDocument.isVerified = true;
              userDocument.save();
              console.log("The account has been verified. Please log in.");

              res.redirect("/verification-status/verified");

              // in this case redirect user to verified page with button to redirect to home directory
            }
          }
        );
      }
    });
  }
);

app.get("/resend-token", function(req, res) {
  isLoggedIn = false;
  res.render("user-verification/resend-verification-token");
});

app.post(
  "/resend-token",
  [
    body("email", "Email is not valid")
      .exists()
      .trim()
      .normalizeEmail()
      .isEmail(),
  ],
  function(req, res) {
    isLoggedIn = false;

    User.findOne({ email: req.body.email }, function(err, userFound) {
      if (err) {
        console.log(err);
      } else if (!userFound) {
        console.log("We were unable to find a user with that email.");

        const result = validationResult(req);
        const alerts = [];
        console.log(result);
        var errors = result.errors;
        for (var i = 0; i < errors.length; i++) {
          alerts.push(errors[i].msg);
          console.log("error msgs: ", errors[i].msg);
        }

        alerts.push("We were unable to find a user with that email.");

        res.render("user-verification/resend-verification-token", {
          alerts: alerts,
        });
      } else if (userFound.isVerified) {
        console.log("This account has already been verified. Please log in.");
        // in this case redirect user to already verified page

        res.redirect("/verification-status/already-verified");
      } else {
        // Create a verification token for this user
        var token = new Token({
          _userId: userFound._id,
          token: crypto.randomBytes(16).toString("hex"),
        });

        // Save the verification token
        token.save(function(err) {
          if (err) {
            console.log("msg: ", err);
          }

          // Send the email using sendgrid Web API or SMTP Relay
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);
          const msg = {
            to: req.body.email, // Change to your recipient
            from: "deepanshuc2001@gmail.com", // Change to your verified sender
            subject: "Account Verification Token",
            text:
              "Hello,\n\n" +
              "Please verify your account by clicking the link: \n" +
              "http://" +
              req.headers.host +
              "/confirmation/" +
              token.token,
            // html: "<strong>and easy to do anywhere, even with Node.js</strong>",
          };
          sgMail
            .send(msg)
            .then(() => {
              console.log("Email sent");

              res.redirect("/verification-status/pending");
            })
            .catch((error) => {
              console.error(error);
            });
        });
      }
    });
  }
);

app.post("/login", function(req, res) {
  const user = new User({
    email: req.body.email,
    password: req.body.password,
  });

  req.login(user, function(err) {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, function() {
        console.log(req.user);
        accountType = null;
        res.redirect("/");
      });
    }
  });
});

let port = process.env.PORT || 5000;

app.listen(port, function() {
  console.log("Server started successfully at " + port + ".");
  if (process.env.NODE_ENV == "devlopment") {
    console.log("Current url- ", "http://localhost:" + port);

    //logs current url on opening website so useful if we want current url inside website. also this requires request to work which we can only get once this website any url is typed
    //console.log("Current url- ", req.protocol + "://" + req.headers.host);
  }
});
