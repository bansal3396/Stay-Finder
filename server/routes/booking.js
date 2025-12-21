router.post("/book", async (req, res) => {
  const { propertyId, userId, startDate, endDate } = req.body;
  const lockKey = `lock:property:${propertyId}`;   //

  // 1️⃣ Acquire Redis lock
  const lock = await redis.set(lockKey, "locked", "NX", "EX", 120);
  if (!lock) {
    return res.status(423).json({
      message: "Another booking is in progress. Try again."
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
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
      await session.abortTransaction();
      return res.status(409).json({
        message: "Property already booked"
      });
    }

    await Booking.create(
      [{
        propertyId,
        userId,
        startDate,
        endDate
      }],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({ message: "Booking successful" });

  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ message: "Booking failed" });
  } finally {
    session.endSession();
    await redis.del(lockKey);
  }
});

