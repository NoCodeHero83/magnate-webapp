// Transaction Data Source
import { supabase } from '../../../lib/supabase';
import { AccountMovement } from '../../../domain/entities/Transaction';

export interface TransferValidationResult {
    valid: boolean;
    error_code: string | null;
    error_message: string | null;
    to_account_id: string | null;
    to_holder_name: string | null;
    is_external: boolean;
    commission_amount: number;
    net_amount: number;
}

export interface ProcessTransferResult {
    success: boolean;
    transaction_id: string;
    amount: number;
    new_balance: number;
    is_external: boolean;
    to_account_id: string | null;
    reference_number: string;
}

const OTP_ERRORS: Record<string, string> = {
    INVALID_CODE: 'Código incorrecto.',
    CODE_EXPIRED: 'El código expiró o ya fue usado. Pide uno nuevo.',
    CODE_MISMATCH: 'El código no corresponde a esta transferencia. Pide uno nuevo.',
    TOO_MANY_ATTEMPTS: 'Demasiados intentos fallidos. Pide un código nuevo.',
    TOO_SOON: 'Espera un minuto antes de pedir otro código.',
    TOO_MANY_REQUESTS: 'Pediste demasiados códigos. Intenta de nuevo más tarde.',
    UNAUTHORIZED: 'No tienes permisos sobre esta cuenta.',
    INVALID_TRANSFER: 'Los datos de la transferencia no son válidos.',
};

/** Mensajes legibles para los errores de la transferencia */
const transferErrorMessage = (raw: string): string => {
    if (raw.includes('AMOUNT_TOO_LOW_FOR_FEE')) return 'El monto no alcanza para cubrir la comisión.';
    if (raw.includes('INSUFFICIENT_BALANCE')) return 'Saldo insuficiente para cubrir el monto y la comisión.';
    if (raw.includes('MONTHLY_LIMIT_EXCEEDED')) return 'Excede el límite mensual de transferencias.';
    if (raw.includes('DAILY_LIMIT_EXCEEDED')) return 'Excede el límite diario de transferencias.';
    if (raw.includes('PER_TRANSACTION_LIMIT_EXCEEDED')) return 'Excede el límite por transacción.';
    if (raw.includes('DESTINATION_NOT_ACTIVE')) return 'La cuenta destino no está habilitada para recibir transferencias.';
    if (raw.includes('ACCOUNT_NOT_ACTIVE')) return 'Tu cuenta no está habilitada para operar en este momento.';
    if (raw.includes('SAME_ACCOUNT')) return 'No puedes transferir a tu propia cuenta.';
    return 'No se pudo completar la transferencia.';
};

/** Lo que cuesta una transferencia antes de confirmarla (lo calcula el servidor) */
export interface TransferQuote {
    fee: number;
    chargeMode: 'deduct' | 'on_top';
    /** Lo que se debita de la cuenta */
    totalDebit: number;
    /** Lo que sale hacia el destino */
    amountSent: number;
}

export type TransferWithCodeResult =
    | { status: 'ok'; result: ProcessTransferResult }
    | { status: 'invalid_code'; code?: string; error: string; attemptsLeft?: number }
    | { status: 'transfer_failed'; error: string };

export class TransactionDataSource {
    /**
     * Get account movements (transactions)
     */
    async getAccountMovements(accountId: string, limit: number = 50, offset: number = 0): Promise<AccountMovement[]> {
        const { data, error } = await supabase
            .from('account_movements')
            .select('*')
            .eq('account_id', accountId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('Error fetching movements:', error);
            return [];
        }

        return data as AccountMovement[];
    }

    /**
     * Get movements within a specific date range
     */
    async getMovementsInRange(accountId: string, start: Date, end: Date): Promise<AccountMovement[]> {
        const { data, error } = await supabase
            .from('account_movements')
            .select('*')
            .eq('account_id', accountId)
            .gte('completed_at', start.toISOString())
            .lte('completed_at', end.toISOString())
            .order('completed_at', { ascending: true });

        if (error) {
            console.error('Error fetching movements in range:', error);
            return [];
        }

        return data as AccountMovement[];
    }

    /**
     * Get single transaction details by ID directly from transactions table
     * This is useful to get extra fields not present in the view
     */
    async getTransactionById(transactionId: string): Promise<any | null> {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', transactionId)
            .single();

        if (error) {
            console.error('Error fetching transaction details:', error);
            return null;
        }

        return data;
    }

    /**
     * Validate a transfer before processing
     */
    async validateTransfer(
        fromAccountId: string,
        toIdentifier: string,
        amount: number,
        paymentMethod: string = 'alias'
    ): Promise<TransferValidationResult> {
        const { data, error } = await supabase
            .rpc('search_account_for_transfer', {
                p_identifier: toIdentifier,
            });

        if (error || !data || (data as any[]).length === 0) {
            console.error('Error validating transfer (lookup failed):', error);
            return {
                valid: false,
                error_code: 'NOT_FOUND',
                error_message: 'Cuenta no encontrada',
                to_account_id: null,
                to_holder_name: null,
                is_external: false,
                commission_amount: 0,
                net_amount: amount,
            };
        }

        const account = (data as any[])[0];

        return {
            valid: true,
            error_code: null,
            error_message: null,
            to_account_id: account.account_id,
            to_holder_name: account.holder_name,
            is_external: account.is_external,
            commission_amount: 0,
            net_amount: amount,
        };
    }

    /**
     * Transferencia con el código enviado por email. El servidor valida que el
     * código corresponda a esta cuenta, destino y monto antes de transferir.
     */
    async transferWithCode(
        fromAccountId: string,
        toIdentifier: string,
        amount: number,
        concept: string | undefined,
        code: string,
        paymentMethod: string = 'alias'
    ): Promise<TransferWithCodeResult> {
        const { data, error } = await supabase.rpc('transfer_with_code', {
            p_from_account_id: fromAccountId,
            p_to_identifier: toIdentifier,
            p_amount: amount,
            p_concept: concept ?? '',
            p_payment_method: paymentMethod,
            p_code: code,
        });

        // Error de la transferencia (saldo, límites, cuenta no habilitada...)
        if (error) {
            return { status: 'transfer_failed', error: transferErrorMessage(error.message) };
        }

        const result = data as any;
        if (result?.success) {
            return { status: 'ok', result: result as ProcessTransferResult };
        }

        // Error del código
        return {
            status: 'invalid_code',
            code: result?.error,
            error: OTP_ERRORS[result?.error] ?? 'No se pudo verificar el código.',
            attemptsLeft: typeof result?.attempts_left === 'number' ? result.attempts_left : undefined,
        };
    }

    /**
     * Get account statistics
     */
    async getAccountStatistics(
        accountId: string,
        startDate: Date,
        endDate: Date
    ): Promise<{
        total_income: number;
        total_expense: number;
        net_balance: number;
        transaction_count: number;
        avg_transaction_amount: number;
    }> {
        const { data, error } = await supabase
            .rpc('get_account_statistics', {
                p_account_id: accountId,
                p_start_date: startDate.toISOString(),
                p_end_date: endDate.toISOString(),
            });

        if (error) {
            console.error('Error fetching account statistics:', error);
            return {
                total_income: 0,
                total_expense: 0,
                net_balance: 0,
                transaction_count: 0,
                avg_transaction_amount: 0,
            };
        }

        // RPC returns a list of rows, we want the first one
        const stats = Array.isArray(data) ? data[0] : data;

        return {
            total_income: Number(stats?.total_income || 0),
            total_expense: Number(stats?.total_expense || 0),
            net_balance: Number(stats?.net_balance || 0),
            transaction_count: Number(stats?.transaction_count || 0),
            avg_transaction_amount: Number(stats?.avg_transaction_amount || 0),
        };
    }

    /**
     * Get balance timeline for charts
     */
    async getBalanceTimeline(
        accountId: string,
        startDate: Date,
        endDate: Date,
        groupBy: 'hour' | 'day' | 'week' | 'month' = 'day'
    ): Promise<Array<{
        period_date: string;
        income: number;
        expense: number;
        net_balance: number;
        cumulative_balance: number;
    }>> {
        const { data, error } = await supabase
            .rpc('get_balance_timeline', {
                p_account_id: accountId,
                p_start_date: startDate.toISOString(),
                p_end_date: endDate.toISOString(),
                p_group_by: groupBy,
            });

        if (error) {
            console.error('Error fetching balance timeline:', error);
            return [];
        }

        return (data as any[]).map(item => ({
            period_date: item.period_date,
            income: Number(item.income || 0),
            expense: Number(item.expense || 0),
            net_balance: Number(item.net_balance || 0),
            cumulative_balance: Number(item.cumulative_balance || 0),
        }));
    }

    /**
     * Comisión de una transferencia antes de confirmarla. null si no se pudo calcular
     * (la transferencia igual la valida el servidor).
     */
    async quoteTransfer(fromAccountId: string, toIdentifier: string, amount: number): Promise<TransferQuote | null> {
        const { data, error } = await supabase.rpc('quote_transfer', {
            p_from_account_id: fromAccountId,
            p_to_identifier: toIdentifier.trim(),
            p_amount: amount,
        });
        const result = data as any;
        if (error || !result?.success) {
            if (error) console.error('Error calculando la comisión:', error);
            return null;
        }
        return {
            fee: Number(result.fee) || 0,
            chargeMode: result.charge_mode,
            totalDebit: Number(result.total_debit) || amount,
            amountSent: Number(result.amount_sent) || amount,
        };
    }

    /**
     * Pide el código de una transferencia concreta. Lo genera y envía el servidor.
     */
    async requestTransferCode(
        fromAccountId: string,
        toIdentifier: string,
        amount: number
    ): Promise<{ success: boolean; error?: string }> {
        const { data, error } = await supabase.rpc('request_transfer_code', {
            p_from_account_id: fromAccountId,
            p_to_identifier: toIdentifier,
            p_amount: amount,
        });

        if (error) {
            console.error('Error pidiendo código de transferencia:', error);
            return { success: false, error: 'No se pudo enviar el código. Revisa tu conexión.' };
        }

        const result = data as any;
        if (result?.success) return { success: true };
        return { success: false, error: OTP_ERRORS[result?.error] ?? 'No se pudo enviar el código.' };
    }
}
