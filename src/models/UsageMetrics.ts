import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database/connection';
import User from './User';
import Session from './Session';

export interface UsageMetricsAttributes {
  id: string;
  userId: string;
  sessionId: string;
  aiProvider: 'openai' | 'anthropic' | 'google';
  model: string;
  tokenCount: number;
  cost: number;
  timestamp?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UsageMetricsCreationAttributes extends Optional<UsageMetricsAttributes, 'id' | 'timestamp' | 'createdAt' | 'updatedAt'> {}

class UsageMetrics extends Model<UsageMetricsAttributes, UsageMetricsCreationAttributes> implements UsageMetricsAttributes {
  public id!: string;
  public userId!: string;
  public sessionId!: string;
  public aiProvider!: 'openai' | 'anthropic' | 'google';
  public model!: string;
  public tokenCount!: number;
  public cost!: number;
  public timestamp!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UsageMetrics.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Session,
        key: 'id',
      },
    },
    aiProvider: {
      type: DataTypes.ENUM('openai', 'anthropic', 'google'),
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tokenCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    cost: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'UsageMetrics',
    tableName: 'usage_metrics',
    timestamps: true,
  }
);

// Define associations
UsageMetrics.belongsTo(User, { foreignKey: 'userId', as: 'user' });
UsageMetrics.belongsTo(Session, { foreignKey: 'sessionId', as: 'session' });
User.hasMany(UsageMetrics, { foreignKey: 'userId', as: 'usageMetrics' });
Session.hasMany(UsageMetrics, { foreignKey: 'sessionId', as: 'usageMetrics' });

export default UsageMetrics;