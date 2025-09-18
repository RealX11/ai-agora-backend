import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database/connection';
import Message from './Message';
import User from './User';

export interface FeedbackAttributes {
  id: string;
  messageId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface FeedbackCreationAttributes extends Optional<FeedbackAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class Feedback extends Model<FeedbackAttributes, FeedbackCreationAttributes> implements FeedbackAttributes {
  public id!: string;
  public messageId!: string;
  public userId!: string;
  public rating!: 1 | 2 | 3 | 4 | 5;
  public comment?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Feedback.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Message,
        key: 'id',
      },
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5,
      },
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Feedback',
    tableName: 'feedback',
    timestamps: true,
  }
);

// Define associations
Feedback.belongsTo(Message, { foreignKey: 'messageId', as: 'message' });
Feedback.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Message.hasMany(Feedback, { foreignKey: 'messageId', as: 'feedback' });
User.hasMany(Feedback, { foreignKey: 'userId', as: 'feedback' });

export default Feedback;