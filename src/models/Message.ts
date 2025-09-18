import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database/connection';
import Session from './Session';

export interface MessageAttributes {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  aiProvider?: 'openai' | 'anthropic' | 'google';
  model?: string;
  tokenCount?: number;
  timestamp?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MessageCreationAttributes extends Optional<MessageAttributes, 'id' | 'timestamp' | 'createdAt' | 'updatedAt'> {}

class Message extends Model<MessageAttributes, MessageCreationAttributes> implements MessageAttributes {
  public id!: string;
  public sessionId!: string;
  public role!: 'user' | 'assistant';
  public content!: string;
  public aiProvider?: 'openai' | 'anthropic' | 'google';
  public model?: string;
  public tokenCount?: number;
  public timestamp!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Session,
        key: 'id',
      },
    },
    role: {
      type: DataTypes.ENUM('user', 'assistant'),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    aiProvider: {
      type: DataTypes.ENUM('openai', 'anthropic', 'google'),
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tokenCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'Message',
    tableName: 'messages',
    timestamps: true,
  }
);

// Define associations
Message.belongsTo(Session, { foreignKey: 'sessionId', as: 'session' });
Session.hasMany(Message, { foreignKey: 'sessionId', as: 'messages' });

export default Message;