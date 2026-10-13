// Authentication Data Source
import { supabase } from '../../../lib/supabase';
import { User, USER_SELECT } from '../../../domain/entities/User';

export class AuthDataSource {
    /**
     * Login with email and web password
     * Validates web access is enabled and password is correct via Edge Function
     */
    async loginWithWebPassword(email: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> {
        try {
            const normalizedEmail = email.toLowerCase().trim();

            // 1. Call Edge Function for secure validation
            const { data, error: invokeError } = await supabase.functions.invoke('web-login', {
                body: { email: normalizedEmail, password: password }
            });

            if (invokeError) {
                console.error('Invoke error:', invokeError);

                // Try to extract the error message from the response body if it's a FunctionsHttpError
                try {
                    if (invokeError.context instanceof Response) {
                        const errorJson = await invokeError.context.clone().json();
                        const errorMsg = errorJson.error || errorJson.message;
                        if (errorMsg) return { success: false, error: errorMsg };
                    } else if (invokeError.context?.json) {
                        const errorMsg = invokeError.context.json.error || invokeError.context.json.message;
                        if (errorMsg) return { success: false, error: errorMsg };
                    }
                } catch (e) {
                    console.error('Failed to parse error response:', e);
                }

                return { success: false, error: 'Error al conectar con el servidor de autenticación' };
            }

            if (!data?.success) {
                return { success: false, error: data?.error || 'Credenciales inválidas' };
            }

            // 2. El servidor validó la contraseña y el estado de la cuenta y creó la sesión.
            //    Ya no se recibe la contraseña de Supabase Auth.
            const { data: authData, error: signInError } = await supabase.auth.setSession({
                access_token: data.session?.access_token,
                refresh_token: data.session?.refresh_token,
            });

            if (signInError) {
                console.error('Sign in error:', signInError);
                return { success: false, error: 'Error al iniciar sesión en el servicio de datos' };
            }

            if (!authData.user) {
                return { success: false, error: 'Error al establecer la sesión' };
            }

            // 6. Fetch full user data to ensure we have all fields for the domain entity
            const { data: fullUserData, error: fullUserError } = await supabase
                .from('users')
                .select(USER_SELECT)
                .eq('id', authData.user.id)
                .single();

            if (fullUserError || !fullUserData) {
                console.error('Error fetching user data:', fullUserError);
                return { success: false, error: 'No se pudieron cargar los datos de tu cuenta' };
            }

            return {
                success: true,
                user: fullUserData as User
            };

        } catch (error: any) {
            console.error('Login error:', error);
            return { success: false, error: error.message || 'Error desconocido' };
        }
    }

    /**
     * Logout current user
     */
    async logout(): Promise<void> {
        await supabase.auth.signOut();
    }

    /**
     * Get current session
     */
    async getCurrentSession() {
        const { data: { session } } = await supabase.auth.getSession();
        return session;
    }

    /**
     * Check if user is authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        const session = await this.getCurrentSession();
        return !!session;
    }
}
