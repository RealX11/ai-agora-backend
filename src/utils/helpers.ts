export const calculateTokenEstimate = (text: string): number => {
  // Rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  }).format(amount);
};

export const truncateText = (text: string, maxLength: number = 100): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const sanitizeUsername = (username: string): string => {
  return username.toLowerCase().replace(/[^a-z0-9_]/g, '');
};

export const generateSessionTitle = (firstMessage: string): string => {
  const cleaned = firstMessage.trim().substring(0, 50);
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export const parseTimeRange = (range: string): { start: Date; end: Date } => {
  const now = new Date();
  const end = new Date(now);
  
  switch (range) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start, end };
    }
    case 'week': {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      return { start: weekStart, end };
    }
    case 'month': {
      const monthStart = new Date(now);
      monthStart.setMonth(now.getMonth() - 1);
      return { start: monthStart, end };
    }
    case 'year': {
      const yearStart = new Date(now);
      yearStart.setFullYear(now.getFullYear() - 1);
      return { start: yearStart, end };
    }
    default: {
      // Default to last 7 days
      const defaultStart = new Date(now);
      defaultStart.setDate(now.getDate() - 7);
      return { start: defaultStart, end };
    }
  }
};