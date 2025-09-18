import User from './User';
import Session from './Session';
import Message from './Message';
import Feedback from './Feedback';
import UsageMetrics from './UsageMetrics';

// Export all models
export {
  User,
  Session,
  Message,
  Feedback,
  UsageMetrics
};

// Define model associations
export const initializeAssociations = () => {
  // User associations
  User.hasMany(Session, { foreignKey: 'userId', as: 'sessions' });
  User.hasMany(Feedback, { foreignKey: 'userId', as: 'feedback' });
  User.hasMany(UsageMetrics, { foreignKey: 'userId', as: 'usageMetrics' });

  // Session associations
  Session.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Session.hasMany(Message, { foreignKey: 'sessionId', as: 'messages' });
  Session.hasMany(UsageMetrics, { foreignKey: 'sessionId', as: 'usageMetrics' });

  // Message associations
  Message.belongsTo(Session, { foreignKey: 'sessionId', as: 'session' });
  Message.hasMany(Feedback, { foreignKey: 'messageId', as: 'feedback' });

  // Feedback associations
  Feedback.belongsTo(Message, { foreignKey: 'messageId', as: 'message' });
  Feedback.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  // UsageMetrics associations
  UsageMetrics.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  UsageMetrics.belongsTo(Session, { foreignKey: 'sessionId', as: 'session' });
};

export default {
  User,
  Session,
  Message,
  Feedback,
  UsageMetrics,
  initializeAssociations
};