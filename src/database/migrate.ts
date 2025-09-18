import sequelize from './connection';
import { initializeAssociations } from '../models';

export const migrateDatabase = async () => {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');

    console.log('Initializing model associations...');
    initializeAssociations();

    console.log('Syncing database schema...');
    await sequelize.sync({ force: false, alter: true });
    console.log('Database schema synchronized successfully.');

  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};

export const dropDatabase = async () => {
  try {
    console.log('Dropping database schema...');
    await sequelize.drop();
    console.log('Database schema dropped successfully.');
  } catch (error) {
    console.error('Error dropping database:', error);
    throw error;
  }
};

if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}