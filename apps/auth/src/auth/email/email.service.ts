export type SendEmailInput = {
  to: string;
  body: string;
  subject?: string;
};

export interface EmailService {
  sendEmail(input: SendEmailInput): Promise<void>;
}

export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');
