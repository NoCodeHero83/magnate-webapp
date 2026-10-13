// Domain Entity: User
// Based on the mobile app's database types

export interface User {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    dni: string;
    cuit_cuil: string;
    web_access_enabled: boolean;
    web_access_enabled_at: string | null;
    verification_status: VerificationStatus;
    account_type: AccountType;
    status_reason: string | null;
    photo_url: string | null;
    created_at: string;
    updated_at: string;
    /** Solo para Persona Jurídica (embed de business_profiles) */
    business_profile?: BusinessProfile | null;
}

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

export type AccountType = 'personal' | 'business';

export interface BusinessProfile {
    user_id: string;
    cuit: string;
    incorporation_date: string;
    legal_entity_type: string;
    legal_name: string;
    trade_name: string | null;
    legal_entity?: { name: string } | null;
}

/**
 * users + perfil de empresa con el nombre del tipo societario.
 * Columnas explícitas: los hashes de PIN y de contraseña web no son legibles desde la API.
 */
export const USER_SELECT: string = 'id, first_name, last_name, email, phone, dni, cuit_cuil, web_access_enabled, web_access_enabled_at, verification_status, zapsign_verification_id, zapsign_verified_at, zapsign_data, created_at, updated_at, photo_url, role, zapsign_contract_url, account_type, status_reason, reviewed_by, reviewed_at, pin_upgrade_required, business_profile:business_profiles(*, legal_entity:legal_entity_types(name))';

/** Nombre a mostrar: nombre de fantasía / razón social para empresas, nombre y apellido para personas */
export function getDisplayName(user: Pick<User, 'first_name' | 'last_name' | 'account_type' | 'business_profile'> | null | undefined, fallback = 'Usuario'): string {
    if (!user) return fallback;
    if (user.account_type === 'business' && user.business_profile) {
        return user.business_profile.trade_name || user.business_profile.legal_name;
    }
    return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || fallback;
}

/** Nombre del titular para comprobantes / CVU: razón social para empresas */
export function getHolderName(user: Pick<User, 'first_name' | 'last_name' | 'account_type' | 'business_profile'> | null | undefined, fallback = 'Usuario'): string {
    if (user?.account_type === 'business' && user.business_profile) {
        return user.business_profile.legal_name;
    }
    return getDisplayName(user, fallback);
}
