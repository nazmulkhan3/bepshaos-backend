import { LoggerService } from '@nestjs/common';

export class AppLogger implements LoggerService {
  private scrubSensitive(data: any): any {
    if (typeof data === 'string') {
      return data.replace(/(password|token|secret|otp|refresh_token|jwt|api_key)=([^&]+)/gi, '$1=***');
    }
    if (typeof data === 'object' && data !== null) {
      const scrubbed = { ...data };
      for (const key of Object.keys(scrubbed)) {
        if (/password|token|secret|otp|refresh_token|jwt|apiKey/i.test(key)) {
          scrubbed[key] = '***';
        } else if (typeof scrubbed[key] === 'object') {
            scrubbed[key] = this.scrubSensitive(scrubbed[key]);
        }
      }
      return scrubbed;
    }
    return data;
  }

  log(message: any, ...optionalParams: any[]) {
    console.log(this.formatMessage('INFO', message, optionalParams));
  }

  error(message: any, ...optionalParams: any[]) {
    console.error(this.formatMessage('ERROR', message, optionalParams));
  }

  warn(message: any, ...optionalParams: any[]) {
    console.warn(this.formatMessage('WARN', message, optionalParams));
  }

  debug?(message: any, ...optionalParams: any[]) {
    console.debug(this.formatMessage('DEBUG', message, optionalParams));
  }

  verbose?(message: any, ...optionalParams: any[]) {
    console.log(this.formatMessage('VERBOSE', message, optionalParams));
  }

  private formatMessage(level: string, message: any, params: any[]) {
    const timestamp = new Date().toISOString();
    let context = '';
    
    // Extract context string from params if available
    if (params && params.length > 0) {
        const lastParam = params[params.length - 1];
        if (typeof lastParam === 'string') {
            context = `[${params.pop()}] `;
        }
    }

    const safeMessage = this.scrubSensitive(message);
    
    // If the message is an Error object, format it specially
    if (safeMessage instanceof Error) {
        return JSON.stringify({ 
            timestamp, 
            level, 
            context: context.trim().replace(/\[|\]/g, ''), 
            message: safeMessage.message, 
            stack: safeMessage.stack 
        });
    }

    // If the message is an object, format it as JSON for structured logging
    if (typeof safeMessage === 'object' && safeMessage !== null) {
       return JSON.stringify({ timestamp, level, context: context.trim().replace(/\[|\]/g, ''), ...safeMessage });
    }

    return `${timestamp} ${level} ${context}${safeMessage}`;
  }
}
