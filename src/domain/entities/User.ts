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
    web_password_hash: string | null;
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

/** users + perfil de empresa con el nombre del tipo societario */
export const USER_SELECT = '*, business_profile:business_profiles(*, legal_entity:legal_entity_types(name))';

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
