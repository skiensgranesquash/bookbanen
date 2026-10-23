/**
 * Håndskrevet Database-type for Supabase-klienten (lib/db/supabaseClient.ts),
 * matchet nøyaktig mot skjemaet i supabase/migrations/0001_init.sql +
 * 0002_add_booking_source.sql.
 *
 * Nyere versjoner av @supabase/supabase-js (prosjektet har endt opp med
 * 2.116.0 – se node_modules/@supabase/supabase-js/package.json) krever en
 * eksplisitt Database-generic for at .insert()/.update()/.select() skal gi
 * fornuftige typer, OG at formen på denne typen matcher nøyaktig:
 * - hver tabell MÅ ha et `Relationships`-felt (brukes til foreign key-info,
 *   tom liste er helt greit når vi ikke trenger den),
 * - `public`-objektet MÅ ha `Views` og `Functions` (tomme er greit siden vi
 *   ikke har noen views eller databasefunksjoner kalt via RPC).
 * Uten akkurat denne formen faller radtypene stille tilbake til `never` i
 * stedet for å gi en tydelig feilmelding – det var årsaken til at den første
 * (ufullstendige) versjonen av denne fila ikke løste TS-feilene.
 *
 * Kolonnene har bevisst plain `string`-typer (ikke literal unions som
 * BookingStatus/BookingKind) – akkurat slik `supabase gen types typescript`
 * selv genererer for en `text`-kolonne med en CHECK-constraint (Postgres
 * eksponerer den ikke som en enum-type). lib/db/supabase.ts caster allerede
 * eksplisitt til de riktige literal-typene via `as GroupRow`/`as SlotRow`,
 * så dette er trygt.
 */
export type Database = {
  __InternalSupabase: {
    PostgrestVersion: string;
  };
  public: {
    Tables: {
      booking_groups: {
        Row: {
          id: string;
          status: string;
          kind: string;
          source: string;
          customer_name: string;
          customer_phone: string;
          total_amount_ore: number;
          payment_reference: string;
          hold_expires_at: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          status: string;
          kind: string;
          source?: string;
          customer_name: string;
          customer_phone: string;
          total_amount_ore: number;
          payment_reference: string;
          hold_expires_at?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          status?: string;
          kind?: string;
          source?: string;
          customer_name?: string;
          customer_phone?: string;
          total_amount_ore?: number;
          payment_reference?: string;
          hold_expires_at?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      booking_slots: {
        Row: {
          id: string;
          group_id: string;
          court_id: string;
          start_time: string;
          end_time: string;
          blocks_time: boolean;
        };
        Insert: {
          id?: string;
          group_id: string;
          court_id: string;
          start_time: string;
          end_time: string;
          /** Settes alltid av databasetriggeren (set_slot_blocks_time) – aldri av applikasjonskoden. */
          blocks_time?: boolean;
        };
        Update: {
          id?: string;
          group_id?: string;
          court_id?: string;
          start_time?: string;
          end_time?: string;
          blocks_time?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "booking_slots_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "booking_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_users: {
        Row: {
          id: string;
          email: string;
          name: string;
          password_hash: string;
          password_salt: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name: string;
          password_hash: string;
          password_salt: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          password_hash?: string;
          password_salt?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
