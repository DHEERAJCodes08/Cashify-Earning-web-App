require("dotenv").config();
var pool = require("./db");
const express = require("express");
const path = require("path");
const env = require("env");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const crypto = require("crypto"); //usimg for generating 4 digit unique code for each user
const session = require("express-session");
const { log, Console } = require("console");
const fileUpload = require("express-fileupload");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth2").Strategy;
const port = process.env.PORT;

var app = express();
app.use(express.json());
app.use(fileUpload());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Session is Create here
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
    resave: false,
  })
);

//fun for generating unique refferal code
// Define an asynchronous function to generate a unique referral code
async function generateUniqueReferralCode() {
  let isUnique = false;
  let referralCode;

  while (!isUnique) {
    referralCode = crypto.randomBytes(4).toString("hex");

    const result = await pool.query(
      "SELECT COUNT(*) FROM userlogin WHERE referral_code = $1",
      [referralCode]
    );

    // Extract the count from the result
    const rowCount = parseInt(result.rows[0].count, 10);

    // If rowCount is 0, the referral code is unique
    if (rowCount === 0) {
      isUnique = true;
    } else {
      // If the referral code is not unique, generate another one in the next iteration
      console.log(
        `Referral code ${referralCode} is not unique. Generating another one...`
      );
    }
  }

  return referralCode;
}

// Sing in with Google
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback",
      passReqToCallback: true,
    },
    async (request, accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists
        const query = {
          text: "SELECT * FROM userlogin WHERE name = $1",
          values: [profile.email],
        };
        const result = await pool.query(query);

        let user;
        if (result.rowCount > 0) {
          // User already exists
          user = result.rows[0];
        } else {
          // User does not exist, create a new user with a default password
          const referralCode = await generateUniqueReferralCode();
          const defaultPassword = "defaultPassword123"; // Define a default password
          const insertQuery = {
            text: "INSERT INTO userlogin (name, password,referral_code) VALUES ($1, $2, $3) RETURNING *",
            values: [profile.email, defaultPassword, referralCode],
          };
          const insertResult = await pool.query(insertQuery);
          user = insertResult.rows[0];
        }

        // Return user object
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    }
  )
);

// Middlewares
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());
app.use(passport.session());

//database Connection
pool.connect(function (error, res) {
  console.log("We are Connecting to database");

  if (error) throw error;
  console.log("Successfully Connected to database");
});

//Routes

//this is the google auth
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["email", "profile"] })
);

//this is the google auth callback route
app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    successRedirect: "/success",
    failureRedirect: "/failure",
  })
);

app.get("/success", (req, res) => {
  if (!req.user) {
    return res.redirect("/failure");
  }

  console.log("User successfully logged in");
  req.session.isLoggedIn = true;

  // Storing user ID in session
  const userId = req.user.id;
  const userEmail = req.user.name;
  req.session.userId = userId;
  req.session.userEmail = userEmail;
  console.log("User ID stored in session:", userId + "and Email " + userEmail);

  res.redirect("/dashboard");
});

app.get("/failure", (req, res) => {
  res.redirect("/auth/google");
});


//THIS ARE ADMIN ROUTES
app.get("/admin", (req, res) => {
  res.render("admindashboard")
});
app.get('/adminwithdraw', async (req, res) => {
  // This is for getting the withdrawal request on the admin panel
  const getwithdrawlrequest = {
    text: "SELECT * FROM user_orders WHERE order_status = 'Pending'"
  };
  try {
    const result = await pool.query(getwithdrawlrequest);
    const records = result.rows;
    res.render('adminwithdraw', { records });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});
app.get('/adminpromotepaynment', async (req, res) => {
  // This is for getting the withdrawal request on the admin panel
  const getpromotepaynmentrequest = {
    text: "SELECT * FROM user_paynment WHERE status = 'Pending'"
  };
  try {
    const result = await pool.query(getpromotepaynmentrequest);
    const records = result.rows;
    res.render('adminpromotepaynment', { records });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});
//END OF ADMIN ROUTES 

app.get("/", function (req, res) {
  res.render("Home");
});

app.get("/promotestatus", async (req, res)=> {


  const getpromotehistory = {
    text: "Select * from user_paynment WHERE user_id = $1 " ,
    values: [req.session.userId]
  }

  try {
    const result = await pool.query(getpromotehistory)
    const userpromotehistory = result.rows;
    res.render("promotestatus", {userpromotehistory});

    
  } catch (error) {
    console.log("Error in getpromotehistory query", error);
  }

});
app.get("/createyoutube", function (req, res) {
  res.render("createyoutube");
});
app.get("/createadds", function (req, res) {
  res.render("createadds");
});

app.get("/selectpromote", function (req, res) {
  if (req.session.isLoggedIn) {
    res.render("selectpromote");
  } else {
    res.redirect("/login");
  }
});

app.get("/payment", (req, res) => {
  const amount = req.query.amount || 0; // Get the amount from the query parameter, default to 0 if not present
  req.session.amountId = amount;
  res.render("payment", { amount }); // Render the payment page with the amount
});
app.get("/minesweeper", function (req, res) {
  res.render("minegame");
});
app.get("/selectearn", function (req, res) {
  res.render("selectearn");
});
app.get("/contact", function (req, res) {
  res.render("contact");
});
app.get("/earn", function (req, res) {
  if (req.session.isLoggedIn) {
    res.render("earn");
  } else {
    res.redirect("/login");
  }
});

app.get("/gamesdashboard", async (req, res) => {
  if (req.session.isLoggedIn) {
    const gamesdashboardbalancequery = {
      text: "SELECT * FROM userearning WHERE user_id = $1",
      values: [req.session.userId],
    };

    try {
      const { rows, rowCount } = await pool.query(gamesdashboardbalancequery);

      res.render("gamesdashboard", { balance: rows });
    } catch (error) {
      console.log("Error executing usergamebalance ", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.post("/update-balance", async (req, res) => {
  if (req.session.isLoggedIn) {
    const { balance } = req.body;
    const updateBalanceQuery = {
      text: "UPDATE userearning SET user_balance = $1 WHERE user_id = $2",
      values: [balance, req.session.userId],
    };

    try {
      await pool.query(updateBalanceQuery);
      res.json({ message: "Balance updated successfully" });
    } catch (error) {
      console.error("Error updating balance:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/profile", async (req, res) => {
  if (req.session.isLoggedIn) {
    const fetchprofile = {
      text: "select * from userinfo where user_id = $1",
      values: [req.session.userId],
    };

    try {
      const { rows, rowCount } = await pool.query(fetchprofile);
      res.render("profile", { profileInfo: rows });
      console.log(rows);
    } catch (error) {
      console.log("Error in executing the fetchprofile query " + error);
    }
  } else {
    res.redirect("/login");
  }
});
app.get("/watchVideo", function (req, res) {
  res.render("watchVideo");
});

app.get("/bankCards", async function (req, res) {
  if (req.session.isLoggedIn) {
    const bankCardsQuery = {
      text: "SELECT * FROM user_bankcard WHERE user_id = $1",
      values: [req.session.userId],
    };

    try {
      const { rows, rowCount } = await pool.query(bankCardsQuery);
      console.log(rows);
      /*     if (rowCount > 0) {
      req.session.userbank_id = rows[0].userbank_id;
      console.log(req.session.userbank_id);
    } */
      res.render("bankcards", { addedBankcards: rows });
    } catch (error) {
      console.log("Error in fetching the Bank cards " + error);
      return res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/dashboard", async (req, res) => {
  if (req.session.isLoggedIn) {
    // Queries
    const bonusClaimedQuery = {
      text: "SELECT * FROM user_bonusclaimed WHERE userclaim_id = $1 AND status = $2",
      values: [req.session.userId, "complete"],
    };

    const userearningQuery = {
      text: "SELECT * FROM userearning WHERE user_id = $1",
      values: [req.session.userId],
    };

    const userinfoNameQuery = {
      text: "SELECT * FROM userinfo WHERE user_id = $1",
      values: [req.session.userId],
    };

    const withdrawOrderQuery = {
      text: "SELECT * FROM user_orders WHERE user_id = $1",
      values: [req.session.userId],
    };

    const searchReferrals = {
      text: "SELECT * FROM referralrecord WHERE referred_id = $1",
      values: [req.session.userId],
    };

    let Userinforows;
    let WithdrowOrderRows;
    let completedbonus = false;
    let referrals = [];

    try {
      const { rows, rowCount } = await pool.query(userearningQuery);
      if (rowCount === 0) {
        const insertQuery = {
          text: "INSERT INTO userearning (user_id, user_balance, user_referral, user_taskcompleted, user_withdrawalcompleted) VALUES ($1, $2, $3, $4, $5)",
          values: [req.session.userId, 0, 0, 0, 0],
        };

        await pool.query(insertQuery);
        console.log(`New row created for user_id: ${req.session.userId}`);
      } else {
        console.log(rows);
      }

      try {
        const result = await pool.query(userinfoNameQuery);
        Userinforows = result.rows;
        console.log(Userinforows);
      } catch (error) {
        console.error("Error executing userinfoNameQuery", error);
        return res.status(500).send("Internal Server Error");
      }

      try {
        const result = await pool.query(withdrawOrderQuery);
        WithdrowOrderRows = result.rows;
        console.log(WithdrowOrderRows);
      } catch (error) {
        console.error("Error executing withdrawOrderQuery", error);
        return res.status(500).send("Internal Server Error");
      }

      try {
        const result = await pool.query(bonusClaimedQuery);
        completedbonus = result.rowCount > 0;
      } catch (err) {
        console.error("Error executing bonusClaimedQuery", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      try {
        const result = await pool.query(searchReferrals);
        if (result.rows.length > 0) {
          referrals = result.rows.map((row) => ({
            name: row.referring_email.split("@")[0],
            image: row.image || "./assets/logo/man.png",
          }));
        } else {
          message = "No Team Members";
        }
      } catch (err) {
        console.error("Error executing searchReferrals query", err);
        return res.status(500).send("Internal Server Error");
      }

      res.render("dashboard", {
        earnings: rows,
        userinfo: Userinforows,
        Withdraworder: WithdrowOrderRows,
        completedbonus,
        referrals,
        message: referrals.length === 0 ? "No Team Members" : null,
      });
    } catch (error) {
      console.error("Error executing userearningQuery", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/coingame", async (req, res) => {
  if (req.session.isLoggedIn) {
    const usergamebalance = {
      text: "SELECT * FROM userearning WHERE user_id = $1",
      values: [req.session.userId],
    };

    try {
      const { rows, rowCount } = await pool.query(usergamebalance);

      res.render("coingame", { balance: rows });
    } catch (error) {
      console.log("Error executing usergamebalance ", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/withdraw", async function (req, res) {
  if (req.session.isLoggedIn) {
    const userbalancequery = {
      text: "SELECT * FROM userearning WHERE user_id = $1",
      values: [req.session.userId],
    };

    const fetchbankCardsQuery = {
      text: "SELECT * FROM user_bankcard WHERE user_id = $1",
      values: [req.session.userId],
    };

    try {
      // Run both queries concurrently
      const [userBalanceResult, bankCardsResult] = await Promise.all([
        pool.query(userbalancequery),
        pool.query(fetchbankCardsQuery),
      ]);

      const balance = userBalanceResult.rows;
      const fetchbankCards = bankCardsResult.rows;

      // Render the page with both results
      res.render("Withdraw", { balance, fetchbankCards });
    } catch (error) {
      console.error("Error in executing queries", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/login", function (req, res) {
  if (req.session.isLoggedIn) {
    res.redirect("/");
  } else {
    res.render("Login&Singup");
  }
});
app.get("/singup", function (req, res) {
  if (req.session.isLoggedIn) {
    res.redirect("/");
  } else {
    res.render("Login&Singup");
  }
});

app.get("/logout", function (req, res) {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      res.status(500).send("Error logging out.");
    } else {
      console.log("Logged out successfully.");
      res.render("Home");
    }
  });
});

/* Post Methods */

//1> Login Post Methods
//1> Login Post Methods
app.post("/Login", async (req, res) => {
  try {
    const { name, password } = req.body;
    console.log("name is " + name + " password is" + password);
    const query = {
      text: "Select * from userlogin WHERE name = $1 and password = $2",
      values: [name, password],
    };

    const { rows, rowCount } = await pool.query(query);
    console.log("Rows:", JSON.stringify(rows, null, 2));
    console.log("rowCount is " + rowCount);

    if (rowCount === 1) {
      console.log("User Succesfully Logged In");
      req.session.isLoggedIn = true;
      //Storing userid in session
      const userId = rows[0].id;
      const userEmail = rows[0].name;
      req.session.userId = userId;
      req.session.userEmail = userEmail;
      console.log("User ID stored in session:", userId);
      res.redirect("/dashboard");
    } else {
      console.log("User Login Failaure");
      res.send("Check your username and password");
    }
  } catch (error) {
    console.log("Performing Query Error of Login" + error);
  }
});

//2> SingUp Post Methods
app.post("/SingUp", async (req, res) => {
  try {
    const { name, password } = req.body;

    const referralCode = await generateUniqueReferralCode();
    const query = {
      text: "INSERT INTO userlogin (name, password,referral_code) VALUES ($1, $2, $3)",
      values: [name, password, referralCode],
    };
    const result = await pool.query(query);
    //console.log(result); //Just to See data

    if (result.rowCount === 1) {
      console.log("User registration Successfull ");

      res.status(200).redirect("/login");
    } else console.log("User registration Failed");
  } catch (error) {
    console.log("Error in SingUp Query" + error);
  }
});

//update balance after withdrawl
app.post("/updateBalance", async (req, res) => {
  if (req.session.isLoggedIn) {
    const userId = req.session.userId;
    const newBalance = req.body.newBalance;
    const withdrawAmount = req.body.withdrawAmount;
    const orderName = "Withdraw";
    const bankCard = req.body.bankCard;
    const accountHolderName = req.body.accountHolderName;

    const updateBalanceQuery = {
      text: "UPDATE userearning SET user_balance = $1, user_withdrawalcompleted = user_withdrawalcompleted + $2 WHERE user_id = $3",
      values: [newBalance, withdrawAmount, userId],
    };

    const create_withdraw_order = {
      text: "INSERT INTO user_orders (user_id, order_name, order_value , order_bankcard , order_accountholder)VALUES ($1, $2, $3, $4 , $5);",
      values: [userId, orderName, withdrawAmount, bankCard, accountHolderName],
    };

    try {
      await pool.query(updateBalanceQuery);
      await pool.query(create_withdraw_order);
      //this status will be sent to the withdraw.ejs
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating balance & creating WithdrawOrder", error);
      res.json({ success: false });
    }
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
});

//add new Bankcard
app.post("/addBankcardForm", async (req, res) => {
  const { accountHolder, bankName, accountNumber, ifscCode, mobileNumber } =
    req.body;

  const addBankcardQuery = {
    text: "INSERT INTO user_bankcard (userbank_fullname, userbank_bankname, userbank_accountno, userbank_ifsc, userbank_mobile, user_id) VALUES ($1, $2, $3, $4, $5, $6)",
    values: [
      accountHolder,
      bankName,
      accountNumber,
      ifscCode,
      mobileNumber,
      req.session.userId,
    ],
  };

  try {
    const { rows, rowCount } = await pool.query(addBankcardQuery);
    console.log("New Added bankdetais are ::");
    res.sendStatus(200); // Send success response
  } catch (error) {
    console.error("Error in executing addBankcardQuery", error);
    res.status(500).send("Internal Server Error"); // Send error response
  }
});

//edit Exesting bankcard
app.post("/editbankcard", async (req, res) => {
  const {
    editBankcardId,
    editAccountHolder,
    editBankName,
    editAccountNumber,
    editIfscCode,
    editMobileNumber,
  } = req.body;
  const updateBankcardQuery = {
    text: "UPDATE user_bankcard SET userbank_fullname = $1, userbank_bankname = $2, userbank_accountno = $3, userbank_ifsc = $4, userbank_mobile= $5 WHERE user_id = $6 AND userbank_id = $7",
    values: [
      editAccountHolder,
      editBankName,
      editAccountNumber,
      editIfscCode,
      editMobileNumber,
      req.session.userId,
      editBankcardId,
    ],
  };

  try {
    const { rows, rowCount } = await pool.query(updateBankcardQuery);
    console.log("Updated banccard details are ::");
    res.sendStatus(200);
  } catch (error) {
    console.error("Error in executing updateBankcardQuery", error);
    res.status(500).send("Internal Server Error");
  }
});

//deleting Banccard
app.post("/deletebankcard", async (req, res) => {
  // Assuming you have already parsed the request body to get the bankcardId
  const { bankcardId } = req.body;
  const deletebankcard = {
    text: "DELETE FROM user_bankcard WHERE user_id = $1 AND userbank_id = $2",
    values: [req.session.userId, bankcardId],
    // If the database operation was successful, send a success response
  };
  try {
    const { rows, rowCount } = await pool.query(deletebankcard);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting bankcard:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/profile", async (req, res) => {
  const { name, email, phone, gender } = req.body;
  const user_id = req.session.userId;
  req.session.userName = name;

  const insertuserinfo = {
    text: "INSERT INTO userinfo ( user_id ,user_name, user_email, user_phone,user_gender) VALUES($1, $2, $3, $4 ,$5)",
    values: [user_id, name, email, phone, gender],
  };

  try {
    const result = await pool.query(insertuserinfo);

    res.redirect("profile");
  } catch (error) {
    console.log("Error in Inserting user Info" + error);
  }
});

app.post("/update-profile", async (req, res) => {
  const { name, email, phone, gender } = req.body;

  const updateprofile = {
    text: "UPDATE userinfo SET user_name = $1, user_email = $2 , user_phone =$3 , user_gender = $4  WHERE user_id = $5",
    values: [name, email, phone, gender, req.session.userId],
  };

  try {
    const result = await pool.query(updateprofile);

    // Assuming the update is successful
    res.status(200).send("Profile updated");
  } catch (error) {
    console.log("Error updating profile:", error);
  }
});

app.post("/update-balance-coingame", async (req, res) => {
  const { balance } = req.body;

  // Check if balance is not undefined and is a number
  if (balance === undefined || typeof balance !== "number") {
    return res.status(400).json({ error: "Invalid balance value" });
  }

  const usercoingamesbalance = {
    text: "UPDATE userearning SET user_balance = $1 WHERE user_id = $2",
    values: [balance, req.session.userId],
  };

  try {
    const { rows } = await pool.query(usercoingamesbalance);
    res.render("coingame", { balance: rows });
  } catch (error) {
    console.log("Error executing usercoingamesbalance ", error);
    res.status(500).send("Internal Server Error");
  }
});


//storing the url temperarily and if the paynment is completed then storing it in database
app.post("/store-url", (req, res) => {
  const videoUrl = req.body.url;
  req.session.videoUrl = videoUrl;
  console.log(req.session.videoUrl);
  res.json({ message: "URL stored successfully" });
});

app.post("/processPayment", async (req, res) => {
  const { name, number, email, paymenttype, utr } = req.body;
  const status = "Pending";

  // Query to check if UTR already exists
  const checkUTRQuery = {
    text: "SELECT COUNT(*) FROM user_paynment WHERE utr = $1",
    values: [utr],
  };

  // Query to insert new payment
  const paymentQuery = {
    text: "INSERT INTO user_paynment (user_id, name, number, email, utr, amount,paymenttype,yturl,status ) VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9)",
    values: [
      req.session.userId,
      name,
      number,
      email,
      utr,
      req.session.amountId,
      paymenttype,
      req.session.videoUrl,
      status,
    ],
  };

  try {
    // Check if UTR already exists
    const checkResult = await pool.query(checkUTRQuery);
    const utrExists = parseInt(checkResult.rows[0].count) > 0;

    if (utrExists) {
      return res.status(400).json({ error: "UTR number already used" });
    }

    // Insert new payment if UTR does not exist
    const { rows, rowCount } = await pool.query(paymentQuery);
    console.log(
      `Payment processed for Name: ${name}, Number: ${number}, Email: ${email}, UTR: ${utr}`
    );
    res.json({ status: "success" });
  } catch (error) {
    console.log("Error executing paymentQuery", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/submit-referral", async (req, res) => {
  const referralCode = req.body.referralCode;
  console.log("Received referral code:", referralCode);

  //getting the name and id details for the person who has referred
  const getdetailsofReferred = {
    text: "SELECT * FROM userlogin WHERE referral_code = $1",
    values: [referralCode],
  };

  try {
    const result = await pool.query(getdetailsofReferred);
    if (result.rowCount > 0) {
      const referred_id = result.rows[0].id;
      const referred_email = result.rows[0].name;
      const referring_id = req.session.userId;
      const referring_email = req.session.userEmail;

      const checkfornotinvitingeachother = {
        text: "SELECT * FROM referralrecord WHERE referred_id = $1 AND referring_id = $2",
        values: [referring_id, referred_id],
      };

      try {
        const result = await pool.query(checkfornotinvitingeachother);
        if (!result.rowCount > 0) {
          const referralrecord = {
            text: `
            INSERT INTO referralrecord (referred_id, referred_email, referral_id, referring_id, referring_email)
            VALUES ($1, $2, $3, $4, $5)`,
            values: [
              referred_id,
              referred_email,
              referralCode,
              referring_id,
              referring_email,
            ],
          };

          try {
            //this is for insetting the referral record
            await pool.query(referralrecord);

            // Update the user balance for referred_id and referring_id
            const updateBalanceReferred = {
              text: `
                      UPDATE userearning
                      SET user_balance = user_balance + 20
                      WHERE user_id = $1`,
              values: [referred_id],
            };

            const updateBalanceReferring = {
              text: `
                      UPDATE userearning
                      SET user_balance = user_balance + 20
                      WHERE user_id = $1`,
              values: [referring_id],
            };

            //update the total referal in dashboard
            const updatetotalreferral = {
              text: `UPDATE userearning SET user_referral = user_referral + 1 WHERE user_id = $1`,
              values: [referred_id],
            };

            const bonusclaimed_query = {
              text: `
              INSERT INTO user_bonusclaimed ( userclaim_id, userclaim_email, status)
              VALUES ($1, $2, $3)`,
              values: [referring_id, referring_email, "complete"],
            };

            try {
              await pool.query(updateBalanceReferred);
              await pool.query(updateBalanceReferring);
              await pool.query(updatetotalreferral);
              await pool.query(bonusclaimed_query);

              // This is the message that is sent to the frontend
              res.json({
                message: "Success! You received 20 rupees.",
                referralCode,
                redirectUrl: "/dashboard",
              });

              console.log(
                "an New user " +
                  " " +
                  referring_email +
                  " " +
                  " Added under " +
                  " " +
                  referred_email
              );
            } catch (err) {
              console.log("Error Updating balances with 20Rupees  " + err);
            }
          } catch (error) {
            console.error("Error executing referral record query", error);
            res.status(500).json({ error: "Internal server error" });
          }
        } else {
          res.status(400).json({ error: "Your Member Under Him " });
        }

        //end of if
      } catch (err) {
        console.error(
          "Error executing checkfornotinvitingeachother query",
          err
        );
        res.status(500).json({ error: "The user cannot be invited " });
      }
    } else {
      res.status(400).json({ error: "Incorrect referral code" });
    }
  } catch (error) {
    console.error("Error executing getdetailsOfReferred", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



  //THIS ARE THE ADMIN ROUTES 

app.post('/admin-promotepaynment-status', async (req, res) => {
  const { paynment_id, ppaynment_status } = req.body;
  console.log(paynment_id, ppaynment_status );

  const updatePPaynmentStatus = {
      text: 'UPDATE user_paynment SET status = $1 WHERE paynment_id = $2',
      values: [ ppaynment_status, paynment_id,]
  };

  try {
      const result = await pool.query(updatePPaynmentStatus);
      if (result.rowCount === 0) {
          // If no rows were affected, it means the order_id was not found
          return res.status(404).json({ success: false, message: 'Order not found' });
      }
      res.json({ success: true });
  } catch (err) {
      console.error('Error updating PPaynment status:', err);
      res.status(500).json({ success: false, message: 'Server Error' });
  }
});
app.post('/admin-update-withdrow-status', async (req, res) => {
  const { order_id, order_status } = req.body;
  console.log(order_status , order_id );

  const updateOrderStatus = {
      text: 'UPDATE user_orders SET order_status = $1 WHERE order_id = $2',
      values: [order_status, order_id]
  };

  try {
      const result = await pool.query(updateOrderStatus);
      if (result.rowCount === 0) {
          // If no rows were affected, it means the order_id was not found
          return res.status(404).json({ success: false, message: 'Order not found' });
      }
      res.json({ success: true });
  } catch (err) {
      console.error('Error updating order status:', err);
      res.status(500).json({ success: false, message: 'Server Error' });
  }
});



//END OF THE ADMIN ROUTES

/* Running Server */
app.listen(port, function (err, res) {
  if (err) throw err;
  console.log("Running on Port " + port);
});
