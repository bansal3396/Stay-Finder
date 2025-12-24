router.post("/book", async (req, res) => {
  const { propertyId, userId, startDate, endDate, amount } = req.body;
  const lockKey = `lock:property:${propertyId}`;

  const lock = await redis.set(lockKey, "NX", "EX", 120);
  
  if (!lock) {
    return res.status(423).json({
      message: "This property is currently being held for another booking. Please try again in a minute."
    });
  }

  const session = await mongoose.startSession();

  try {
    const existing = await Booking.findOne({
      propertyId,
      startDate: { $lt: new Date(endDate) },
      endDate: { $gt: new Date(startDate) }
    });

    if (existing) {
      return res.status(409).json({ message: "Property already booked for these dates." });
    }
    const paymentResponse = await paymentGateway.process({
      userId,
      amount,
      currency: "USD"
    });

    if (paymentResponse.status !== 'success') {
      throw new Error("Payment failed"); 
    }

    session.startTransaction();

    const conflict = await Booking.findOne(
      {
        propertyId,
        startDate: { $lt: new Date(endDate) },
        endDate: { $gt: new Date(startDate) }
      },
      null,
      { session }
    );

    if (conflict) {
      //  rare edge case where the lock might have expired
      await session.abortTransaction();
      // for refund here
      return res.status(409).json({ message: "Conflict detected during finalization." });
    }

    await Booking.create(
      [{
        propertyId,
        userId,
        startDate,
        endDate,
        paymentId: paymentResponse.id // Store the transaction ID
      }],
      { session }
    );
    
    await session.commitTransaction();
    res.status(201).json({ message: "Booking and Payment successful" });

  } catch (err) {
    if (session.inAtomicity()) {
      await session.abortTransaction();
    }
    
    console.error("Booking Error:", err);
    res.status(err.message === "Payment failed" ? 402 : 500).json({ 
      message: err.message || "Internal server error" 
    });

  }
  session.endSession();
  await redis.del(lockKey);
  }
);
