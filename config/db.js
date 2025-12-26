import mongoose from "mongoose";

const connectDB = async () => {
  try {
    // Removed deprecated options (useNewUrlParser/useUnifiedTopology are default in Mongoose 6+)
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;