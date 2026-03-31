const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");

router.post("/", orderController.createOrder);
router.get("/", orderController.getOrders);

// ✅ MUST come before /:id — otherwise Express matches "track" as the :id param
router.get("/:id/track", orderController.trackOrder);

router.get("/:id", orderController.getOrderById);
router.put("/:id/status", orderController.updateOrderStatus);
router.put("/:id/assign", orderController.assignRider);
router.put("/:id/location", orderController.updateLocation);

module.exports = router;