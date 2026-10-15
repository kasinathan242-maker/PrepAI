const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prepai').then(async () => {
  const salt = await bcrypt.genSalt(10);
  const prepaiAdminHash = await bcrypt.hash('20062006', salt);
  const adminHash = await bcrypt.hash('Admin@2026', salt);
  const studentHash = await bcrypt.hash('Student@2026', salt);

  await mongoose.connection.db.collection('users').updateOne(
    { email: 'admin@prep.ai' },
    {
      $set: {
        email: 'admin@prep.ai',
        passwordHash: prepaiAdminHash,
        fullName: 'Placement Officer',
        collegeName: 'National Institute of Technology',
        role: 'admin',
        isActive: true,
        createdAt: new Date(),
        lastActive: new Date()
      }
    },
    { upsert: true }
  );

  await mongoose.connection.db.collection('users').updateOne(
    { email: 'admin@college.edu' },
    {
      $set: {
        email: 'admin@college.edu',
        passwordHash: adminHash,
        fullName: 'Dr. Sharma (Placement TPO)',
        collegeName: 'National Institute of Technology',
        branch: 'Computer Science',
        graduationYear: 2026,
        role: 'admin',
        totalXp: 3800,
        currentStreak: 18,
        longestStreak: 24,
        isActive: true,
        createdAt: new Date(),
        lastActive: new Date()
      }
    },
    { upsert: true }
  );

  await mongoose.connection.db.collection('users').updateOne(
    { email: 'alex.mercer@college.edu' },
    {
      $set: {
        email: 'alex.mercer@college.edu',
        passwordHash: studentHash,
        fullName: 'Alex Mercer',
        collegeName: 'National Institute of Technology',
        branch: 'Computer Science',
        graduationYear: 2026,
        role: 'student',
        targetRoles: ['Software Development Engineer'],
        totalXp: 3840,
        currentStreak: 12,
        longestStreak: 18,
        isActive: true,
        createdAt: new Date(),
        lastActive: new Date()
      }
    },
    { upsert: true }
  );

  console.log('✅ Demo accounts upserted successfully into MongoDB:');
  console.log('   - admin@college.edu / Admin@2026 (Admin)');
  console.log('   - alex.mercer@college.edu / Student@2026 (Student)');
  process.exit(0);
});
