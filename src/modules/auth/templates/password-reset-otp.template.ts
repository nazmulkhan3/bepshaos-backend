export const passwordResetOtpTemplate = (otp: string) => `BebshaOS

Password Reset Request

Your password reset code is:

${otp}

This code expires in 5 minutes.

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

© BebshaOS
`;
