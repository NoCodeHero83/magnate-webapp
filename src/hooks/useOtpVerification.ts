import { useState, useEffect, useCallback } from "react";
import { OTP_MAX_ATTEMPTS, OTP_COUNTDOWN_SECONDS } from "@/constants/app";

/** Resultado de validar el código en el servidor */
export interface OtpVerifyResult {
  success: boolean;
  /** Mensaje a mostrar si falló */
  error?: string;
  /** Intentos que le quedan a este código (según el servidor) */
  attemptsLeft?: number;
  /** El código ya no sirve: hay que pedir uno nuevo */
  blocked?: boolean;
}

interface UseOtpVerificationOptions {
  maxAttempts?: number;
  countdownSeconds?: number;
  /** Valida el código en el servidor (el código nunca se conoce en el cliente) */
  verifyCode: (code: string) => Promise<OtpVerifyResult>;
  /** Pide un código nuevo; devolver un mensaje de error si falla */
  onResend?: () => Promise<string | void>;
}

interface UseOtpVerificationReturn {
  otpValue: string;
  setOtpValue: (value: string) => void;
  attempts: number;
  countdown: number;
  isBlocked: boolean;
  isVerifying: boolean;
  isSendingCode: boolean;
  otpError: string;
  isVerifyDisabled: boolean;
  maxAttempts: number;
  verify: () => void;
  resendCode: () => void;
  reset: () => void;
  clearError: () => void;
  setError: (message: string) => void;
}

/**
 * Hook para la verificación OTP: countdown, intentos y bloqueo.
 * La validación la hace el servidor (verifyCode); los intentos reflejan los del servidor.
 */
export const useOtpVerification = ({
  maxAttempts = OTP_MAX_ATTEMPTS,
  countdownSeconds = OTP_COUNTDOWN_SECONDS,
  verifyCode,
  onResend,
}: UseOtpVerificationOptions): UseOtpVerificationReturn => {
  const [otpValue, setOtpValue] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [countdown, setCountdown] = useState(countdownSeconds);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Reset all state
  const reset = useCallback(() => {
    setOtpValue("");
    setOtpError("");
    setAttempts(0);
    setCountdown(countdownSeconds);
    setIsBlocked(false);
    setIsVerifying(false);
    setIsActive(true);
  }, [countdownSeconds]);

  const clearError = useCallback(() => {
    setOtpError("");
  }, []);

  // Countdown timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (isActive && countdown > 0 && !isBlocked) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [isActive, countdown, isBlocked]);

  // Verify OTP (servidor)
  const verify = useCallback(async () => {
    if (isBlocked || isVerifying || otpValue.length !== 6) return;

    setIsVerifying(true);
    setOtpError("");

    try {
      const result = await verifyCode(otpValue);
      if (result.success) {
        setIsActive(false);
        return;
      }

      if (typeof result.attemptsLeft === "number") {
        setAttempts(Math.max(0, maxAttempts - result.attemptsLeft));
      }
      if (result.blocked) {
        setIsBlocked(true);
        setAttempts(maxAttempts);
      }
      setOtpError(result.error || "Código incorrecto.");
      setOtpValue("");
    } catch (error) {
      setOtpError("No se pudo verificar el código. Revisa tu conexión.");
    } finally {
      setIsVerifying(false);
    }
  }, [otpValue, isBlocked, isVerifying, maxAttempts, verifyCode]);

  // Resend code
  const resendCode = useCallback(async () => {
    setIsSendingCode(true);
    setOtpError("");

    try {
      const error = onResend ? await onResend() : undefined;
      if (error) {
        setOtpError(error);
      } else {
        reset();
      }
    } catch (error: any) {
      setOtpError("Error al enviar el código. Reintente en unos momentos.");
    } finally {
      setIsSendingCode(false);
    }
  }, [onResend, reset]);

  const isVerifyDisabled =
    otpValue.length !== 6 ||
    isVerifying ||
    isBlocked;

  return {
    otpValue,
    setOtpValue,
    attempts,
    countdown,
    isBlocked,
    isVerifying,
    isSendingCode,
    otpError,
    isVerifyDisabled,
    maxAttempts,
    verify,
    resendCode,
    reset,
    clearError,
    setError: setOtpError,
  };
};
