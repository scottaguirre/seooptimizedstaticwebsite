const requireAuth = require('../middleware/requireAuth');
const { checkCredits } = require("../utils/helpers"); 
const express = require('express');
const router = express.Router();


router.post("/api/check-credits", requireAuth, async (req, res) => {
try {
const pages = req.body.pages;

const { ok, pagesCount, totalCost } = await checkCredits(req.user, pages);

res.json({
    ok,
    pagesCount,
    totalCost,
    available: req.user.credits
});

} catch (err) {
    console.error("check-credits error:", err);
    res.status(500).json({
        ok: false,
        error: "Server error"
    });
}
});
  
module.exports = router;

  