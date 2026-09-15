export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          action_detail: string | null
          action_outcome: string | null
          action_taken_at: string | null
          answer: string
          answered_by: string
          created_by: string
          detail: string | null
          id: string
          occurred_at: string
          organization_id: string
          outcome: string
          proposed_action: Json | null
          question: string
          tools: Json
        }
        Insert: {
          action_detail?: string | null
          action_outcome?: string | null
          action_taken_at?: string | null
          answer?: string
          answered_by: string
          created_by: string
          detail?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          outcome: string
          proposed_action?: Json | null
          question: string
          tools?: Json
        }
        Update: {
          action_detail?: string | null
          action_outcome?: string | null
          action_taken_at?: string | null
          answer?: string
          answered_by?: string
          created_by?: string
          detail?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          outcome?: string
          proposed_action?: Json | null
          question?: string
          tools?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistant_deployments: {
        Row: {
          assistant_id: string
          created_at: string
          display_name: string
          enabled: boolean
          greeting: string
          handoff_destination: string | null
          handoff_message: string
          id: string
          organization_id: string
          public_site_id: string | null
          surface: string
          updated_at: string
        }
        Insert: {
          assistant_id: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          greeting?: string
          handoff_destination?: string | null
          handoff_message?: string
          id?: string
          organization_id: string
          public_site_id?: string | null
          surface: string
          updated_at?: string
        }
        Update: {
          assistant_id?: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          greeting?: string
          handoff_destination?: string | null
          handoff_message?: string
          id?: string
          organization_id?: string
          public_site_id?: string | null
          surface?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_deployments_organization_id_assistant_id_fkey"
            columns: ["organization_id", "assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_assistant_deployments_organization_id_public_site_id_fkey"
            columns: ["organization_id", "public_site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_assistant_knowledge_sources: {
        Row: {
          assistant_id: string
          created_at: string
          id: string
          organization_id: string
          public_site_id: string
          source_kind: string
        }
        Insert: {
          assistant_id: string
          created_at?: string
          id?: string
          organization_id: string
          public_site_id: string
          source_kind: string
        }
        Update: {
          assistant_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          public_site_id?: string
          source_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_knowledge_source_organization_id_assistant_id_fkey"
            columns: ["organization_id", "assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_assistant_knowledge_source_organization_id_public_site__fkey"
            columns: ["organization_id", "public_site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_assistants: {
        Row: {
          created_at: string
          created_by: string
          id: string
          instructions: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          instructions?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assistants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_readings: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          read_at: string
          unit: string
          value: number
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          read_at?: string
          unit: string
          value: number
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          read_at?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_readings_asset_same_org"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "asset_readings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_readings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          created_at: string
          created_by: string
          custom: Json
          customer_id: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          custom?: Json
          customer_id?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          custom?: Json
          customer_id?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "assets_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_actions: {
        Row: {
          action_kind: string
          channel: string | null
          created_at: string
          created_by: string
          id: string
          organization_id: string
          position: number
          rule_id: string
          shift_minutes: number | null
          status_id: string | null
          template_id: string | null
          work_item_type_id: string | null
        }
        Insert: {
          action_kind: string
          channel?: string | null
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          position?: number
          rule_id: string
          shift_minutes?: number | null
          status_id?: string | null
          template_id?: string | null
          work_item_type_id?: string | null
        }
        Update: {
          action_kind?: string
          channel?: string | null
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          position?: number
          rule_id?: string
          shift_minutes?: number | null
          status_id?: string | null
          template_id?: string | null
          work_item_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_actions_new_status_same_type"
            columns: ["organization_id", "work_item_type_id", "status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "automation_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_actions_rule_same_org"
            columns: ["organization_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "automation_actions_status_same_org"
            columns: ["organization_id", "status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "automation_actions_template_same_org"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "automation_actions_type_same_org"
            columns: ["organization_id", "work_item_type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_conditions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          operator: string
          organization_id: string
          position: number
          rule_id: string
          subject_field: string
          value: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          operator: string
          organization_id: string
          position?: number
          rule_id: string
          subject_field: string
          value?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          operator?: string
          organization_id?: string
          position?: number
          rule_id?: string
          subject_field?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_conditions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_conditions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_conditions_rule_same_org"
            columns: ["organization_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_counter_marks: {
        Row: {
          asset_id: string
          last_value: number
          organization_id: string
          rule_id: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          last_value: number
          organization_id: string
          rule_id: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          last_value?: number
          organization_id?: string
          rule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_counter_marks_asset_same_org"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "automation_counter_marks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_counter_marks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_counter_marks_rule_same_org"
            columns: ["organization_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          name: string
          organization_id: string
          trigger_comparison: string | null
          trigger_counter_step: number | null
          trigger_event_action: string | null
          trigger_kind: string
          trigger_metric: string | null
          trigger_offset_minutes: number | null
          trigger_threshold: number | null
          trigger_unit: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          trigger_comparison?: string | null
          trigger_counter_step?: number | null
          trigger_event_action?: string | null
          trigger_kind: string
          trigger_metric?: string | null
          trigger_offset_minutes?: number | null
          trigger_threshold?: number | null
          trigger_unit?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          trigger_comparison?: string | null
          trigger_counter_step?: number | null
          trigger_event_action?: string | null
          trigger_kind?: string
          trigger_metric?: string | null
          trigger_offset_minutes?: number | null
          trigger_threshold?: number | null
          trigger_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          detail: string | null
          id: string
          occurred_at: string
          organization_id: string
          outcome: string
          rule_id: string
          rule_name: string
          subject_id: string
          subject_type: string
          trigger_kind: string
        }
        Insert: {
          detail?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          outcome: string
          rule_id: string
          rule_name: string
          subject_id: string
          subject_type: string
          trigger_kind: string
        }
        Update: {
          detail?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          outcome?: string
          rule_id?: string
          rule_name?: string
          subject_id?: string
          subject_type?: string
          trigger_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_settings: {
        Row: {
          accent: string | null
          body_font: string | null
          heading_font: string | null
          logo_path: string | null
          organization_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          accent?: string | null
          body_font?: string | null
          heading_font?: string | null
          logo_path?: string | null
          organization_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          accent?: string | null
          body_font?: string | null
          heading_font?: string | null
          logo_path?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string
          id: string
          occurred_at: string
          organization_id: string
          payload: Json
          payload_hash: string
          raw_status: string | null
          source: string
        }
        Insert: {
          call_id: string
          id?: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          payload_hash: string
          raw_status?: string | null
          source: string
        }
        Update: {
          call_id?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          payload_hash?: string
          raw_status?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_same_org"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "call_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_outcomes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          position: number
          reached: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          position?: number
          reached?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          position?: number
          reached?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "call_outcomes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_outcomes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_participants: {
        Row: {
          call_id: string
          created_at: string
          external_id: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          member_id: string | null
          on_hold: boolean
          organization_id: string
          party: string
          status: string
        }
        Insert: {
          call_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          member_id?: string | null
          on_hold?: boolean
          organization_id: string
          party: string
          status?: string
        }
        Update: {
          call_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          member_id?: string | null
          on_hold?: boolean
          organization_id?: string
          party?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_participants_call_same_org"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "call_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          conference_name: string | null
          created_at: string
          created_by: string
          customer_id: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          external_id: string | null
          from_number: string
          id: string
          note: string
          organization_id: string
          outcome_id: string | null
          recording_url: string | null
          started_at: string
          status: string
          to_number: string
        }
        Insert: {
          conference_name?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          external_id?: string | null
          from_number: string
          id?: string
          note?: string
          organization_id: string
          outcome_id?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          to_number: string
        }
        Update: {
          conference_name?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          external_id?: string | null
          from_number?: string
          id?: string
          note?: string
          organization_id?: string
          outcome_id?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_outcome_same_org"
            columns: ["organization_id", "outcome_id"]
            isOneToOne: false
            referencedRelation: "call_outcomes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_credits: {
        Row: {
          amount_minor: number
          call_id: string | null
          channel: Database["public"]["Enums"]["communication_channel"] | null
          created_by: string | null
          currency: string
          id: string
          note: string
          occurred_at: string
          organization_id: string
          reason: string
        }
        Insert: {
          amount_minor: number
          call_id?: string | null
          channel?: Database["public"]["Enums"]["communication_channel"] | null
          created_by?: string | null
          currency: string
          id?: string
          note?: string
          occurred_at?: string
          organization_id: string
          reason: string
        }
        Update: {
          amount_minor?: number
          call_id?: string | null
          channel?: Database["public"]["Enums"]["communication_channel"] | null
          created_by?: string | null
          currency?: string
          id?: string
          note?: string
          occurred_at?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_credits_call_same_org"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_credits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_credits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_entries: {
        Row: {
          body: string
          channel: string
          created_at: string
          delivery_state: string
          direction: string
          id: string
          organization_id: string
          thread_id: string
        }
        Insert: {
          body?: string
          channel: string
          created_at?: string
          delivery_state?: string
          direction: string
          id?: string
          organization_id: string
          thread_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          delivery_state?: string
          direction?: string
          id?: string
          organization_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_entries_organization_id_thread_id_fkey"
            columns: ["organization_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "communication_threads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_rates: {
        Row: {
          channel: Database["public"]["Enums"]["communication_channel"]
          currency: string
          id: string
          unit_amount_minor: number
          updated_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["communication_channel"]
          currency: string
          id?: string
          unit_amount_minor: number
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["communication_channel"]
          currency?: string
          id?: string
          unit_amount_minor?: number
          updated_at?: string
        }
        Relationships: []
      }
      communication_threads: {
        Row: {
          channel: string
          created_at: string
          customer_id: string | null
          external_actor_id: string | null
          id: string
          organization_id: string
          public_site_id: string | null
          state: string
          updated_at: string
          visitor_key: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          customer_id?: string | null
          external_actor_id?: string | null
          id?: string
          organization_id: string
          public_site_id?: string | null
          state?: string
          updated_at?: string
          visitor_key?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          customer_id?: string | null
          external_actor_id?: string | null
          id?: string
          organization_id?: string
          public_site_id?: string | null
          state?: string
          updated_at?: string
          visitor_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_threads_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_external_actor_id_fkey"
            columns: ["organization_id", "external_actor_id"]
            isOneToOne: false
            referencedRelation: "external_actors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_public_site_id_fkey"
            columns: ["organization_id", "public_site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      configuration_proposals: {
        Row: {
          applied_at: string | null
          created_at: string
          created_by: string
          description: string
          detail: string | null
          drafted_by: string
          gaps: Json
          id: string
          organization_id: string
          outcome: string
          result: Json | null
          shape: Json
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          created_by: string
          description: string
          detail?: string | null
          drafted_by: string
          gaps?: Json
          id?: string
          organization_id: string
          outcome?: string
          result?: Json | null
          shape: Json
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          detail?: string | null
          drafted_by?: string
          gaps?: Json
          id?: string
          organization_id?: string
          outcome?: string
          result?: Json | null
          shape?: Json
        }
        Relationships: [
          {
            foreignKeyName: "configuration_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuration_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_locations: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          location_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          location_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          location_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_locations_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_locations_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_invites: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          id: string
          organization_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_invites_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_portal_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_stages: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          created_by: string
          custom: Json
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          stage_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          custom?: Json
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          stage_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          custom?: Json
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_stage_same_org"
            columns: ["organization_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "customer_stages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      dashboard_reports: {
        Row: {
          created_at: string
          created_by: string
          dashboard_id: string
          id: string
          organization_id: string
          position: number
          report_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dashboard_id: string
          id?: string
          organization_id: string
          position?: number
          report_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dashboard_id?: string
          id?: string
          organization_id?: string
          position?: number
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_reports_dashboard_same_org"
            columns: ["organization_id", "dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "dashboard_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_reports_report_same_org"
            columns: ["organization_id", "report_id"]
            isOneToOne: false
            referencedRelation: "report_definitions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          asset_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          file_name: string
          id: string
          location_id: string | null
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          work_item_id: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          file_name: string
          id?: string
          location_id?: string | null
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          work_item_id?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          file_name?: string
          id?: string
          location_id?: string | null
          mime_type?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_asset_same_org"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "documents_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "documents_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      events: {
        Row: {
          action: string
          actor_id: string
          entity_id: string
          entity_type: string
          id: string
          occurred_at: string
          organization_id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_id: string
          entity_id: string
          entity_type: string
          id?: string
          occurred_at?: string
          organization_id: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_actors: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_actors_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "external_actors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_actors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_readings: {
        Row: {
          applies_at: string
          id: string
          location_id: string
          metric: string
          observed_at: string
          organization_id: string
          unit: string
          value: number
        }
        Insert: {
          applies_at: string
          id?: string
          location_id: string
          metric: string
          observed_at?: string
          organization_id: string
          unit: string
          value: number
        }
        Update: {
          applies_at?: string
          id?: string
          location_id?: string
          metric?: string
          observed_at?: string
          organization_id?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "external_readings_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "external_readings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_readings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_links: {
        Row: {
          connector_key: string
          external_record_id: string
          first_imported_at: string
          gold_entity_id: string
          gold_entity_type: string
          id: string
          last_synced_at: string
          organization_id: string
          resource_id: string | null
          run_id: string | null
          source_hash: string | null
        }
        Insert: {
          connector_key: string
          external_record_id: string
          first_imported_at?: string
          gold_entity_id: string
          gold_entity_type: string
          id?: string
          last_synced_at?: string
          organization_id: string
          resource_id?: string | null
          run_id?: string | null
          source_hash?: string | null
        }
        Update: {
          connector_key?: string
          external_record_id?: string
          first_imported_at?: string
          gold_entity_id?: string
          gold_entity_type?: string
          id?: string
          last_synced_at?: string
          organization_id?: string
          resource_id?: string | null
          run_id?: string | null
          source_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_record_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_links_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "external_record_links_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      field_definitions: {
        Row: {
          created_at: string
          created_by: string
          entity_type: string
          id: string
          key: string
          kind: string
          label: string
          options: string[]
          organization_id: string
          position: number
          required: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          entity_type: string
          id?: string
          key: string
          kind: string
          label: string
          options?: string[]
          organization_id: string
          position?: number
          required?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          entity_type?: string
          id?: string
          key?: string
          kind?: string
          label?: string
          options?: string[]
          organization_id?: string
          position?: number
          required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "field_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          connector_key: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          initiated_by: string
          mapping_id: string | null
          mapping_snapshot: Json
          organization_id: string
          resource_id: string | null
          rows_created: number
          rows_failed: number
          rows_seen: number
          rows_skipped: number
          rows_updated: number
          started_at: string
          status: string
        }
        Insert: {
          connector_key: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by: string
          mapping_id?: string | null
          mapping_snapshot: Json
          organization_id: string
          resource_id?: string | null
          rows_created?: number
          rows_failed?: number
          rows_seen?: number
          rows_skipped?: number
          rows_updated?: number
          started_at?: string
          status?: string
        }
        Update: {
          connector_key?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string
          mapping_id?: string | null
          mapping_snapshot?: Json
          organization_id?: string
          resource_id?: string | null
          rows_created?: number
          rows_failed?: number
          rows_seen?: number
          rows_skipped?: number
          rows_updated?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_organization_id_mapping_id_fkey"
            columns: ["organization_id", "mapping_id"]
            isOneToOne: false
            referencedRelation: "integration_mappings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_runs_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      import_staging_rows: {
        Row: {
          created_at: string
          id: string
          matched_customer_id: string | null
          normalized: Json
          organization_id: string
          proposed_action: string
          raw: Json
          run_id: string
          source_record_key: string
          status: string
          validation_errors: Json
        }
        Insert: {
          created_at?: string
          id?: string
          matched_customer_id?: string | null
          normalized?: Json
          organization_id: string
          proposed_action?: string
          raw?: Json
          run_id: string
          source_record_key: string
          status?: string
          validation_errors?: Json
        }
        Update: {
          created_at?: string
          id?: string
          matched_customer_id?: string | null
          normalized?: Json
          organization_id?: string
          proposed_action?: string
          raw?: Json
          run_id?: string
          source_record_key?: string
          status?: string
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_staging_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staging_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staging_rows_organization_id_matched_customer_id_fkey"
            columns: ["organization_id", "matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_staging_rows_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          account_label: string | null
          connected_by: string
          connector_key: string
          created_at: string
          id: string
          last_verified_at: string | null
          organization_id: string
          scopes: string[]
          secret_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          connected_by: string
          connector_key: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          organization_id: string
          scopes?: string[]
          secret_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          connected_by?: string
          connector_key?: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          organization_id?: string
          scopes?: string[]
          secret_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_mappings: {
        Row: {
          created_at: string
          created_by: string
          dedupe_key: string | null
          id: string
          mapping: Json
          organization_id: string
          resource_id: string
          sync_mode: string
          target_entity: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dedupe_key?: string | null
          id?: string
          mapping?: Json
          organization_id: string
          resource_id: string
          sync_mode?: string
          target_entity?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dedupe_key?: string | null
          id?: string
          mapping?: Json
          organization_id?: string
          resource_id?: string
          sync_mode?: string
          target_entity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_mappings_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_resources: {
        Row: {
          connection_id: string
          created_at: string
          display_name: string
          external_id: string | null
          id: string
          metadata: Json
          organization_id: string
          resource_type: string
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          display_name: string
          external_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          resource_type: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          display_name?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          resource_type?: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_resources_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          currency: string
          description: string
          id: string
          invoice_id: string
          organization_id: string
          position: number
          quantity: number
          unit: string
          unit_amount_minor: number
        }
        Insert: {
          currency: string
          description: string
          id?: string
          invoice_id: string
          organization_id: string
          position: number
          quantity: number
          unit: string
          unit_amount_minor: number
        }
        Update: {
          currency?: string
          description?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          position?: number
          quantity?: number
          unit?: string
          unit_amount_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_same_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          billed_to: string
          created_by: string
          currency: string
          customer_id: string | null
          due_at: string | null
          id: string
          issued_at: string
          number: number
          organization_id: string
          work_item_id: string
        }
        Insert: {
          billed_to: string
          created_by: string
          currency: string
          customer_id?: string | null
          due_at?: string | null
          id?: string
          issued_at?: string
          number: number
          organization_id: string
          work_item_id: string
        }
        Update: {
          billed_to?: string
          created_by?: string
          currency?: string
          customer_id?: string | null
          due_at?: string | null
          id?: string
          issued_at?: string
          number?: number
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      locations: {
        Row: {
          access_notes: string | null
          address: string
          created_at: string
          created_by: string
          custom: Json
          id: string
          label: string
          latitude: number | null
          longitude: number | null
          organization_id: string
        }
        Insert: {
          access_notes?: string | null
          address: string
          created_at?: string
          created_by: string
          custom?: Json
          id?: string
          label: string
          latitude?: number | null
          longitude?: number | null
          organization_id: string
        }
        Update: {
          access_notes?: string | null
          address?: string
          created_at?: string
          created_by?: string
          custom?: Json
          id?: string
          label?: string
          latitude?: number | null
          longitude?: number | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          created_at: string
          created_by: string
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          title: string | null
          visibility: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          created_by: string
          file_name: string
          id?: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          title?: string | null
          visibility?: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          created_by?: string
          file_name?: string
          id?: string
          mime_type?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
          title?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          created_by: string
          display_name: string
          id: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          display_name: string
          id?: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          display_name?: string
          id?: string
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_role_same_org"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      message_deliveries: {
        Row: {
          body: string
          channel: string
          detail: string | null
          id: string
          organization_id: string
          queued_at: string
          recipient: string
          rule_id: string
          rule_name: string
          sent_at: string | null
          state: string
          subject_id: string
          subject_line: string
          subject_type: string
        }
        Insert: {
          body: string
          channel: string
          detail?: string | null
          id?: string
          organization_id: string
          queued_at?: string
          recipient: string
          rule_id: string
          rule_name: string
          sent_at?: string | null
          state?: string
          subject_id: string
          subject_line?: string
          subject_type: string
        }
        Update: {
          body?: string
          channel?: string
          detail?: string | null
          id?: string
          organization_id?: string
          queued_at?: string
          recipient?: string
          rule_id?: string
          rule_name?: string
          sent_at?: string | null
          state?: string
          subject_id?: string
          subject_line?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          subject?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_hours: {
        Row: {
          closes_at: string
          created_at: string
          created_by: string
          day_of_week: number
          id: string
          opens_at: string
          organization_id: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          created_by: string
          day_of_week: number
          id?: string
          opens_at: string
          organization_id: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          created_by?: string
          day_of_week?: number
          id?: string
          opens_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_commercial_terms: {
        Row: {
          currency: string | null
          id: string
          note: string
          organization_id: string
          period_end: string
          period_start: string
          price_minor: number
          product_key: string
          quantity: number
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          currency?: string | null
          id?: string
          note?: string
          organization_id: string
          period_end: string
          period_start: string
          price_minor: number
          product_key: string
          quantity?: number
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          currency?: string | null
          id?: string
          note?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          price_minor?: number
          product_key?: string
          quantity?: number
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_commercial_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_commercial_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_commercial_terms_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "platform_products"
            referencedColumns: ["key"]
          },
        ]
      }
      organization_feature_activation_overrides: {
        Row: {
          disabled_at: string
          disabled_by: string
          feature_id: string
          organization_id: string
        }
        Insert: {
          disabled_at?: string
          disabled_by: string
          feature_id: string
          organization_id: string
        }
        Update: {
          disabled_at?: string
          disabled_by?: string
          feature_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_feature_activation_overrides_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_activation_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_activation_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          role_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by: string
          email: string
          expires_at?: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          role_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          role_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_role_same_org"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_modules: {
        Row: {
          enabled_at: string
          enabled_by: string
          module_key: string
          organization_id: string
        }
        Insert: {
          enabled_at?: string
          enabled_by: string
          module_key: string
          organization_id: string
        }
        Update: {
          enabled_at?: string
          enabled_by?: string
          module_key?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plan_agreements: {
        Row: {
          amount_minor: number
          currency: string
          effective_from: string
          id: string
          note: string
          organization_id: string
          plan_id: string
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          amount_minor: number
          currency: string
          effective_from?: string
          id?: string
          note?: string
          organization_id: string
          plan_id: string
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          amount_minor?: number
          currency?: string
          effective_from?: string
          id?: string
          note?: string
          organization_id?: string
          plan_id?: string
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plan_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_agreements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plan_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          id: string
          note: string
          organization_id: string
          period_end: string
          period_start: string
          plan_id: string
          plan_kind: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          id?: string
          note?: string
          organization_id: string
          period_end: string
          period_start: string
          plan_id: string
          plan_kind: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          id?: string
          note?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          plan_id?: string
          plan_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plan_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plan_quota_overrides: {
        Row: {
          allowance_key: string
          effective_from: string
          hard_limit: number | null
          id: string
          included_quantity: number
          note: string
          organization_id: string
          plan_id: string
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          allowance_key: string
          effective_from?: string
          hard_limit?: number | null
          id?: string
          included_quantity: number
          note?: string
          organization_id: string
          plan_id: string
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          allowance_key?: string
          effective_from?: string
          hard_limit?: number | null
          id?: string
          included_quantity?: number
          note?: string
          organization_id?: string
          plan_id?: string
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plan_quota_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_quota_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_quota_overrides_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_platform_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          organization_id: string
          plan_id: string | null
          price_reference: string
          provider: string
          status: string
          subscription_reference: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment: string
          id?: string
          organization_id: string
          plan_id?: string | null
          price_reference: string
          provider?: string
          status: string
          subscription_reference: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          organization_id?: string
          plan_id?: string | null
          price_reference?: string
          provider?: string
          status?: string
          subscription_reference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_platform_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_platform_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_platform_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profiles: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          display_name: string | null
          intro: string | null
          organization_id: string
          tagline: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          display_name?: string | null
          intro?: string | null
          organization_id: string
          tagline?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          display_name?: string | null
          intro?: string | null
          organization_id?: string
          tagline?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_provider_bindings: {
        Row: {
          created_at: string
          external_account_id: string | null
          id: string
          last_error: string | null
          last_verified_at: string | null
          metadata: Json
          organization_id: string
          provider_key: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          organization_id: string
          provider_key: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          organization_id?: string
          provider_key?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_provider_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_provider_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_provider_bindings_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      organization_provider_resources: {
        Row: {
          binding_id: string
          config: Json
          created_at: string
          external_id: string
          id: string
          last_verified_at: string | null
          organization_id: string
          resource_type: string
          secret_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          binding_id: string
          config?: Json
          created_at?: string
          external_id: string
          id?: string
          last_verified_at?: string | null
          organization_id: string
          resource_type: string
          secret_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          binding_id?: string
          config?: Json
          created_at?: string
          external_id?: string
          id?: string
          last_verified_at?: string | null
          organization_id?: string
          resource_type?: string
          secret_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_provider_resources_organization_id_binding_id_fkey"
            columns: ["organization_id", "binding_id"]
            isOneToOne: false
            referencedRelation: "organization_provider_bindings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_provider_resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_provider_resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          buffer_minutes: number
          created_at: string
          created_by: string
          currency: string | null
          id: string
          name: string
          operational_state: string
          slug: string | null
          timezone: string
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          created_by: string
          currency?: string | null
          id?: string
          name: string
          operational_state?: string
          slug?: string | null
          timezone?: string
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          created_by?: string
          currency?: string | null
          id?: string
          name?: string
          operational_state?: string
          slug?: string | null
          timezone?: string
        }
        Relationships: []
      }
      payment_accounts: {
        Row: {
          account_id: string
          connected_at: string
          connected_by: string
          organization_id: string
          provider: string
        }
        Insert: {
          account_id: string
          connected_at?: string
          connected_by: string
          organization_id: string
          provider: string
        }
        Update: {
          account_id?: string
          connected_at?: string
          connected_by?: string
          organization_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          amount_minor: number
          created_by: string
          currency: string
          id: string
          invoice_id: string
          organization_id: string
          provider: string
          provider_reference: string
          requested_at: string
        }
        Insert: {
          amount_minor: number
          created_by: string
          currency: string
          id?: string
          invoice_id: string
          organization_id: string
          provider: string
          provider_reference: string
          requested_at?: string
        }
        Update: {
          amount_minor?: number
          created_by?: string
          currency?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          provider?: string
          provider_reference?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_invoice_same_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          created_by: string
          currency: string
          id: string
          invoice_id: string
          note: string | null
          organization_id: string
          provider: string | null
          provider_reference: string | null
          received_at: string
        }
        Insert: {
          amount_minor: number
          created_by: string
          currency: string
          id?: string
          invoice_id: string
          note?: string | null
          organization_id: string
          provider?: string | null
          provider_reference?: string | null
          received_at?: string
        }
        Update: {
          amount_minor?: number
          created_by?: string
          currency?: string
          id?: string
          invoice_id?: string
          note?: string | null
          organization_id?: string
          provider?: string | null
          provider_reference?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_same_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_number_assignments: {
        Row: {
          assigned_at: string
          created_by: string | null
          id: string
          is_default: boolean
          member_id: string | null
          organization_id: string
          outbound_allowed: boolean
          phone_number_id: string
          released_at: string | null
          resource_id: string | null
        }
        Insert: {
          assigned_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          member_id?: string | null
          organization_id: string
          outbound_allowed?: boolean
          phone_number_id: string
          released_at?: string | null
          resource_id?: string | null
        }
        Update: {
          assigned_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          member_id?: string | null
          organization_id?: string
          outbound_allowed?: boolean
          phone_number_id?: string
          released_at?: string | null
          resource_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_number_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_number_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_number_assignments_organization_id_member_id_fkey"
            columns: ["organization_id", "member_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "phone_number_assignments_organization_id_phone_number_id_fkey"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "phone_number_assignments_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "phone_number_assignments_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          created_at: string
          created_by: string | null
          e164: string
          health: string
          health_checked_at: string | null
          id: string
          inbound_enabled: boolean
          label: string | null
          lifecycle: string
          organization_id: string
          outbound_enabled: boolean
          provider_resource_id: string
          purpose: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          e164: string
          health?: string
          health_checked_at?: string | null
          id?: string
          inbound_enabled?: boolean
          label?: string | null
          lifecycle?: string
          organization_id: string
          outbound_enabled?: boolean
          provider_resource_id: string
          purpose?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          e164?: string
          health?: string
          health_checked_at?: string | null
          id?: string
          inbound_enabled?: boolean
          label?: string | null
          lifecycle?: string
          organization_id?: string
          outbound_enabled?: boolean
          provider_resource_id?: string
          purpose?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_organization_id_provider_resource_id_fkey"
            columns: ["organization_id", "provider_resource_id"]
            isOneToOne: true
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      platform_billing_checkout_sessions: {
        Row: {
          environment: string
          id: string
          organization_id: string
          plan_price_id: string
          provider_reference: string | null
          requested_at: string
          requested_by: string
        }
        Insert: {
          environment: string
          id?: string
          organization_id: string
          plan_price_id: string
          provider_reference?: string | null
          requested_at?: string
          requested_by: string
        }
        Update: {
          environment?: string
          id?: string
          organization_id?: string
          plan_price_id?: string
          provider_reference?: string | null
          requested_at?: string
          requested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_checkout_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_checkout_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_checkout_sessions_plan_price_id_fkey"
            columns: ["plan_price_id"]
            isOneToOne: false
            referencedRelation: "platform_plan_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_customers: {
        Row: {
          created_at: string
          created_by: string
          customer_reference: string
          environment: string
          id: string
          organization_id: string
          provider: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_reference: string
          environment: string
          id?: string
          organization_id: string
          provider?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_reference?: string
          environment?: string
          id?: string
          organization_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_webhook_events: {
        Row: {
          environment: string
          event_reference: string
          event_type: string
          id: string
          organization_id: string | null
          provider: string
          received_at: string
        }
        Insert: {
          environment: string
          event_reference: string
          event_type: string
          id?: string
          organization_id?: string | null
          provider?: string
          received_at?: string
        }
        Update: {
          environment?: string
          event_reference?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          provider?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_catalog_feature_dependencies: {
        Row: {
          feature_id: string
          requires_feature_id: string
        }
        Insert: {
          feature_id: string
          requires_feature_id: string
        }
        Update: {
          feature_id?: string
          requires_feature_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_catalog_feature_dependencies_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_catalog_feature_dependencies_requires_feature_id_fkey"
            columns: ["requires_feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_catalog_features: {
        Row: {
          ai_powered: boolean
          created_at: string
          description: string
          display_order: number
          id: string
          implementation_state: string
          key: string
          label: string
          lifecycle: string
          meter_ids: string[]
          metered: boolean
          module_id: string
          packaging_default: string
          provider_capabilities: string[]
          sale_status: string
        }
        Insert: {
          ai_powered?: boolean
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          implementation_state: string
          key: string
          label: string
          lifecycle?: string
          meter_ids?: string[]
          metered?: boolean
          module_id: string
          packaging_default?: string
          provider_capabilities?: string[]
          sale_status?: string
        }
        Update: {
          ai_powered?: boolean
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          implementation_state?: string
          key?: string
          label?: string
          lifecycle?: string
          meter_ids?: string[]
          metered?: boolean
          module_id?: string
          packaging_default?: string
          provider_capabilities?: string[]
          sale_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_catalog_features_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_catalog_modules: {
        Row: {
          created_at: string
          description: string
          display_order: number
          id: string
          key: string
          label: string
          product_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key: string
          label: string
          product_id: string
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          label?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_catalog_modules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_catalog_products: {
        Row: {
          created_at: string
          description: string
          display_order: number
          id: string
          key: string
          label: string
          lifecycle: string
          sale_status: string
        }
        Insert: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key: string
          label: string
          lifecycle?: string
          sale_status?: string
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          label?: string
          lifecycle?: string
          sale_status?: string
        }
        Relationships: []
      }
      platform_catalog_runtime_mappings: {
        Row: {
          created_at: string
          feature_id: string
          id: string
          mapping_kind: string
          mapping_value: string
          note: string
        }
        Insert: {
          created_at?: string
          feature_id: string
          id?: string
          mapping_kind: string
          mapping_value: string
          note?: string
        }
        Update: {
          created_at?: string
          feature_id?: string
          id?: string
          mapping_kind?: string
          mapping_value?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_catalog_runtime_mappings_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_meters: {
        Row: {
          created_at: string
          description: string
          id: string
          unit: string
        }
        Insert: {
          created_at?: string
          description: string
          id: string
          unit: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          unit?: string
        }
        Relationships: []
      }
      platform_plan_feature_grants: {
        Row: {
          created_at: string
          feature_id: string
          included: boolean
          plan_id: string
        }
        Insert: {
          created_at?: string
          feature_id: string
          included: boolean
          plan_id: string
        }
        Update: {
          created_at?: string
          feature_id?: string
          included?: boolean
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_feature_grants_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_plan_feature_grants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_module_grants: {
        Row: {
          created_at: string
          granted_scope: string
          module_id: string
          plan_id: string
        }
        Insert: {
          created_at?: string
          granted_scope?: string
          module_id: string
          plan_id: string
        }
        Update: {
          created_at?: string
          granted_scope?: string
          module_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_module_grants_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_plan_module_grants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_prices: {
        Row: {
          amount_minor: number
          approval_state: string
          billing_interval: string
          captured_at: string
          currency: string
          effective_from: string
          id: string
          note: string
          plan_id: string
          recorded_by: string
          source: string
          source_url: string | null
        }
        Insert: {
          amount_minor: number
          approval_state?: string
          billing_interval: string
          captured_at?: string
          currency: string
          effective_from?: string
          id?: string
          note?: string
          plan_id: string
          recorded_by: string
          source?: string
          source_url?: string | null
        }
        Update: {
          amount_minor?: number
          approval_state?: string
          billing_interval?: string
          captured_at?: string
          currency?: string
          effective_from?: string
          id?: string
          note?: string
          plan_id?: string
          recorded_by?: string
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_product_grants: {
        Row: {
          created_at: string
          granted_scope: string
          plan_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          granted_scope?: string
          plan_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          granted_scope?: string
          plan_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_product_grants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_plan_product_grants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_provider_prices: {
        Row: {
          environment: string
          id: string
          plan_price_id: string
          price_reference: string
          product_reference: string
          provider: string
          provisioned_at: string
          provisioned_by: string
        }
        Insert: {
          environment: string
          id?: string
          plan_price_id: string
          price_reference: string
          product_reference: string
          provider?: string
          provisioned_at?: string
          provisioned_by: string
        }
        Update: {
          environment?: string
          id?: string
          plan_price_id?: string
          price_reference?: string
          product_reference?: string
          provider?: string
          provisioned_at?: string
          provisioned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_provider_prices_plan_price_id_fkey"
            columns: ["plan_price_id"]
            isOneToOne: false
            referencedRelation: "platform_plan_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_quotas: {
        Row: {
          allowance_key: string
          created_at: string
          display_order: number
          hard_limit: number | null
          id: string
          included_quantity: number
          label: string
          meter_id: string | null
          overage_policy: string
          period: string
          plan_id: string
          service_class: string | null
          unit: string
        }
        Insert: {
          allowance_key: string
          created_at?: string
          display_order?: number
          hard_limit?: number | null
          id?: string
          included_quantity: number
          label: string
          meter_id?: string | null
          overage_policy?: string
          period?: string
          plan_id: string
          service_class?: string | null
          unit: string
        }
        Update: {
          allowance_key?: string
          created_at?: string
          display_order?: number
          hard_limit?: number | null
          id?: string
          included_quantity?: number
          label?: string
          meter_id?: string | null
          overage_policy?: string
          period?: string
          plan_id?: string
          service_class?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_quotas_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_plan_quotas_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plans: {
        Row: {
          billable: boolean
          created_at: string
          created_by: string
          description: string
          display_order: number
          id: string
          key: string
          kind: string
          label: string
          sale_status: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          created_by: string
          description?: string
          display_order?: number
          id?: string
          key: string
          kind: string
          label: string
          sale_status?: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          created_by?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          kind?: string
          label?: string
          sale_status?: string
        }
        Relationships: []
      }
      platform_product_prices: {
        Row: {
          amount_minor: number
          approval_state: string
          billing_interval: string
          currency: string
          effective_from: string
          id: string
          note: string
          product_key: string
          recorded_at: string
          recorded_by: string
          source: string
        }
        Insert: {
          amount_minor: number
          approval_state?: string
          billing_interval?: string
          currency: string
          effective_from?: string
          id?: string
          note?: string
          product_key: string
          recorded_at?: string
          recorded_by: string
          source: string
        }
        Update: {
          amount_minor?: number
          approval_state?: string
          billing_interval?: string
          currency?: string
          effective_from?: string
          id?: string
          note?: string
          product_key?: string
          recorded_at?: string
          recorded_by?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_product_prices_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "platform_products"
            referencedColumns: ["key"]
          },
        ]
      }
      platform_products: {
        Row: {
          created_at: string
          description: string
          display_order: number
          key: string
          kind: string
          label: string
          module_key: string | null
          sale_status: string
        }
        Insert: {
          created_at?: string
          description?: string
          display_order?: number
          key: string
          kind: string
          label: string
          module_key?: string | null
          sale_status?: string
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          key?: string
          kind?: string
          label?: string
          module_key?: string | null
          sale_status?: string
        }
        Relationships: []
      }
      platform_provider_rates: {
        Row: {
          approval_state: string
          captured_at: string
          currency: string
          effective_from: string
          id: string
          meter_id: string
          note: string
          provider_key: string
          recorded_by: string
          source: string
          source_url: string | null
          unit_amount_micros: number
        }
        Insert: {
          approval_state?: string
          captured_at?: string
          currency: string
          effective_from?: string
          id?: string
          meter_id: string
          note?: string
          provider_key: string
          recorded_by: string
          source: string
          source_url?: string | null
          unit_amount_micros: number
        }
        Update: {
          approval_state?: string
          captured_at?: string
          currency?: string
          effective_from?: string
          id?: string
          meter_id?: string
          note?: string
          provider_key?: string
          recorded_by?: string
          source?: string
          source_url?: string | null
          unit_amount_micros?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_rates_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_provider_rates_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      platform_provider_sync_failures: {
        Row: {
          created_at: string
          detail: string
          id: string
          meter_id: string | null
          occurred_at: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          detail: string
          id?: string
          meter_id?: string | null
          occurred_at?: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string
          id?: string
          meter_id?: string | null
          occurred_at?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_sync_failures_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_provider_sync_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_provider_sync_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_providers: {
        Row: {
          created_at: string
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          key: string
          label: string
        }
        Update: {
          created_at?: string
          key?: string
          label?: string
        }
        Relationships: []
      }
      platform_retail_rates: {
        Row: {
          approval_state: string
          captured_at: string
          currency: string
          effective_from: string
          id: string
          meter_id: string
          note: string
          recorded_by: string
          source: string
          source_url: string | null
          unit_amount_micros: number
        }
        Insert: {
          approval_state?: string
          captured_at?: string
          currency: string
          effective_from?: string
          id?: string
          meter_id: string
          note?: string
          recorded_by: string
          source: string
          source_url?: string | null
          unit_amount_micros: number
        }
        Update: {
          approval_state?: string
          captured_at?: string
          currency?: string
          effective_from?: string
          id?: string
          meter_id?: string
          note?: string
          recorded_by?: string
          source?: string
          source_url?: string | null
          unit_amount_micros?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_retail_rates_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          gold_public_organization_id: string | null
          gold_public_site_id: string | null
          singleton: boolean
          workflow_review_organization_id: string | null
        }
        Insert: {
          gold_public_organization_id?: string | null
          gold_public_site_id?: string | null
          singleton?: boolean
          workflow_review_organization_id?: string | null
        }
        Update: {
          gold_public_organization_id?: string | null
          gold_public_site_id?: string | null
          singleton?: boolean
          workflow_review_organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_gold_public_site_fk"
            columns: ["gold_public_organization_id", "gold_public_site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "platform_settings_workflow_review_organization_id_fkey"
            columns: ["workflow_review_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_settings_workflow_review_organization_id_fkey"
            columns: ["workflow_review_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_staff: {
        Row: {
          created_at: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_support_sessions: {
        Row: {
          ended_at: string | null
          expires_at: string
          id: string
          organization_id: string
          reason: string | null
          staff_user_id: string
          started_at: string
        }
        Insert: {
          ended_at?: string | null
          expires_at?: string
          id?: string
          organization_id: string
          reason?: string | null
          staff_user_id: string
          started_at?: string
        }
        Update: {
          ended_at?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          reason?: string | null
          staff_user_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_support_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_support_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_book_items: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          id: string
          name: string
          organization_id: string
          unit: string
          unit_amount_minor: number
        }
        Insert: {
          created_at?: string
          created_by: string
          currency: string
          id?: string
          name: string
          organization_id: string
          unit: string
          unit_amount_minor: number
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          name?: string
          organization_id?: string
          unit?: string
          unit_amount_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_book_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_book_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_communication_rate_limits: {
        Row: {
          count: number
          expires_at: string
          key: string
          window_started_at: string
        }
        Insert: {
          count: number
          expires_at: string
          key: string
          window_started_at: string
        }
        Update: {
          count?: number
          expires_at?: string
          key?: string
          window_started_at?: string
        }
        Relationships: []
      }
      public_page_revisions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_source: string
          id: string
          organization_id: string
          page_id: string
          published_at: string | null
          published_by: string | null
          revision_number: number
          sections: Json
          seo_description: string
          seo_title: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_source: string
          id?: string
          organization_id: string
          page_id: string
          published_at?: string | null
          published_by?: string | null
          revision_number: number
          sections: Json
          seo_description: string
          seo_title: string
          status: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_source?: string
          id?: string
          organization_id?: string
          page_id?: string
          published_at?: string | null
          published_by?: string | null
          revision_number?: number
          sections?: Json
          seo_description?: string
          seo_title?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_page_revisions_organization_id_page_id_fkey"
            columns: ["organization_id", "page_id"]
            isOneToOne: false
            referencedRelation: "public_pages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      public_pages: {
        Row: {
          created_at: string
          current_published_revision_id: string | null
          id: string
          organization_id: string
          page_key: string
          site_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          current_published_revision_id?: string | null
          id?: string
          organization_id: string
          page_key: string
          site_id: string
          slug: string
        }
        Update: {
          created_at?: string
          current_published_revision_id?: string | null
          id?: string
          organization_id?: string
          page_key?: string
          site_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_pages_organization_id_site_id_fkey"
            columns: ["organization_id", "site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "public_pages_published_revision_belongs_to_page"
            columns: ["organization_id", "id", "current_published_revision_id"]
            isOneToOne: false
            referencedRelation: "public_page_revisions"
            referencedColumns: ["organization_id", "page_id", "id"]
          },
        ]
      }
      public_sites: {
        Row: {
          created_at: string
          created_by: string | null
          default_locale: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      report_definition_roles: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          report_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          report_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          report_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_definition_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_definition_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_definition_roles_report_same_org"
            columns: ["organization_id", "report_id"]
            isOneToOne: false
            referencedRelation: "report_definitions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "report_definition_roles_role_same_org"
            columns: ["organization_id", "role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      report_definitions: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string | null
          grouping: string
          id: string
          location_id: string | null
          measure: string
          name: string
          organization_id: string
          period: string
          resource_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id?: string | null
          grouping: string
          id?: string
          location_id?: string | null
          measure?: string
          name: string
          organization_id: string
          period: string
          resource_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string | null
          grouping?: string
          id?: string
          location_id?: string | null
          measure?: string
          name?: string
          organization_id?: string
          period?: string
          resource_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_definitions_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "report_definitions_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "report_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_definitions_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "report_definitions_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          created_by: string
          custom: Json
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          custom?: Json
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          custom?: Json
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          capabilities: string[]
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          capabilities?: string[]
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          capabilities?: string[]
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_settings: {
        Row: {
          calling_number: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calling_number?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calling_number?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telephony_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_cost_reconciliations: {
        Row: {
          id: string
          note: string
          organization_id: string
          provider_currency: string
          provider_reference: string
          reconciled_at: string
          reconciled_provider_cost_micros: number
          recorded_by: string | null
          source: string
          usage_event_id: string
        }
        Insert: {
          id?: string
          note?: string
          organization_id: string
          provider_currency: string
          provider_reference?: string
          reconciled_at?: string
          reconciled_provider_cost_micros: number
          recorded_by?: string | null
          source: string
          usage_event_id: string
        }
        Update: {
          id?: string
          note?: string
          organization_id?: string
          provider_currency?: string
          provider_reference?: string
          reconciled_at?: string
          reconciled_provider_cost_micros?: number
          recorded_by?: string | null
          source?: string
          usage_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_cost_reconciliations_event_same_org"
            columns: ["organization_id", "usage_event_id"]
            isOneToOne: false
            referencedRelation: "usage_events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "usage_cost_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          customer_charge_micros: number
          customer_currency: string
          id: string
          meter_id: string
          note: string
          occurred_at: string
          organization_id: string
          provider_cost_micros: number
          provider_currency: string | null
          provider_key: string
          quantity: number
        }
        Insert: {
          created_at?: string
          customer_charge_micros?: number
          customer_currency: string
          id?: string
          meter_id: string
          note?: string
          occurred_at?: string
          organization_id: string
          provider_cost_micros?: number
          provider_currency?: string | null
          provider_key: string
          quantity: number
        }
        Update: {
          created_at?: string
          customer_charge_micros?: number
          customer_currency?: string
          id?: string
          meter_id?: string
          note?: string
          occurred_at?: string
          organization_id?: string
          provider_cost_micros?: number
          provider_currency?: string | null
          provider_key?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      user_phone_number_preferences: {
        Row: {
          member_id: string
          organization_id: string
          phone_number_id: string
          updated_at: string
        }
        Insert: {
          member_id: string
          organization_id: string
          phone_number_id: string
          updated_at?: string
        }
        Update: {
          member_id?: string
          organization_id?: string
          phone_number_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_phone_number_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_phone_number_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_phone_number_preferences_organization_id_member_id_fkey"
            columns: ["organization_id", "member_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "user_phone_number_preferences_organization_id_phone_number_fkey"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_checklist_items: {
        Row: {
          created_at: string
          created_by: string
          done_at: string | null
          done_by: string | null
          id: string
          label: string
          organization_id: string
          position: number
          work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          label: string
          organization_id: string
          position?: number
          work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          label?: string
          organization_id?: string
          position?: number
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_checklist_items_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_costs: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          incurred_at: string
          organization_id: string
          work_item_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by: string
          currency: string
          description: string
          id?: string
          incurred_at?: string
          organization_id: string
          work_item_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          id?: string
          incurred_at?: string
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_costs_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_priced_lines: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          organization_id: string
          quantity: number
          unit: string
          unit_amount_minor: number
          work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency: string
          description: string
          id?: string
          organization_id: string
          quantity: number
          unit: string
          unit_amount_minor: number
          work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          id?: string
          organization_id?: string
          quantity?: number
          unit?: string
          unit_amount_minor?: number
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_priced_lines_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_statuses: {
        Row: {
          created_at: string
          created_by: string
          id: string
          marks_complete: boolean
          name: string
          organization_id: string
          position: number
          releases_resource: boolean
          type_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          marks_complete?: boolean
          name: string
          organization_id: string
          position?: number
          releases_resource?: boolean
          type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          marks_complete?: boolean
          name?: string
          organization_id?: string
          position?: number
          releases_resource?: boolean
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_statuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_statuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_statuses_type_same_org"
            columns: ["organization_id", "type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_time_entries: {
        Row: {
          created_at: string
          created_by: string
          id: string
          note: string | null
          organization_id: string
          resource_id: string | null
          work_item_id: string
          worked_during: unknown
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          organization_id: string
          resource_id?: string | null
          work_item_id: string
          worked_during: unknown
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          organization_id?: string
          resource_id?: string | null
          work_item_id?: string
          worked_during?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "work_item_time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_time_entries_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_time_entries_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_time_entries_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_transitions: {
        Row: {
          created_at: string
          created_by: string
          from_status_id: string
          id: string
          organization_id: string
          to_status_id: string
          type_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          from_status_id: string
          id?: string
          organization_id: string
          to_status_id: string
          type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          from_status_id?: string
          id?: string
          organization_id?: string
          to_status_id?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_transitions_from_same_org_and_type"
            columns: ["organization_id", "type_id", "from_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "work_item_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_transitions_to_same_org_and_type"
            columns: ["organization_id", "type_id", "to_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "work_item_transitions_type_same_org"
            columns: ["organization_id", "type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_type_checklist_items: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          organization_id: string
          position: number
          type_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          organization_id: string
          position?: number
          type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          organization_id?: string
          position?: number
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_type_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_type_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_type_checklist_items_type_same_org"
            columns: ["organization_id", "type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_types: {
        Row: {
          booking_duration_minutes: number | null
          booking_price_item_id: string | null
          booking_status_id: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          booking_duration_minutes?: number | null
          booking_price_item_id?: string | null
          booking_status_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          booking_duration_minutes?: number | null
          booking_price_item_id?: string | null
          booking_status_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_types_booking_price_same_org"
            columns: ["organization_id", "booking_price_item_id"]
            isOneToOne: false
            referencedRelation: "price_book_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_types_booking_status_same_type"
            columns: ["organization_id", "id", "booking_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "work_item_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          asset_id: string | null
          created_at: string
          created_by: string
          custom: Json
          customer_id: string | null
          id: string
          location_id: string | null
          occupies: unknown
          organization_id: string
          resource_id: string | null
          scheduled_during: unknown
          status_id: string
          status_releases_resource: boolean
          title: string
          type_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          created_by: string
          custom?: Json
          customer_id?: string | null
          id?: string
          location_id?: string | null
          occupies?: unknown
          organization_id: string
          resource_id?: string | null
          scheduled_during?: unknown
          status_id: string
          status_releases_resource?: boolean
          title: string
          type_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          created_by?: string
          custom?: Json
          customer_id?: string | null
          id?: string
          location_id?: string | null
          occupies?: unknown
          organization_id?: string
          resource_id?: string | null
          scheduled_during?: unknown
          status_id?: string
          status_releases_resource?: boolean
          title?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_asset_same_org"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_status_same_org_and_type"
            columns: ["organization_id", "type_id", "status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "work_items_type_same_org"
            columns: ["organization_id", "type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Views: {
      bookable_resources: {
        Row: {
          id: string | null
          organization_id: string | null
        }
        Insert: {
          id?: string | null
          organization_id?: string | null
        }
        Update: {
          id?: string | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_activity: {
        Row: {
          action: string | null
          actor_id: string | null
          customer_id: string | null
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          occurred_at: string | null
          organization_id: string | null
          payload: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_failures: {
        Row: {
          detail: string | null
          kind: string | null
          occurred_at: string | null
          organization_id: string | null
          subject: string | null
        }
        Relationships: []
      }
      platform_tenants: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string | null
          last_activity_at: string | null
          module_keys: string[] | null
          name: string | null
          operational_state: string | null
          slug: string | null
          timezone: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string | null
          last_activity_at?: never
          module_keys?: never
          name?: string | null
          operational_state?: string | null
          slug?: string | null
          timezone?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string | null
          last_activity_at?: never
          module_keys?: never
          name?: string | null
          operational_state?: string | null
          slug?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      resource_commitments: {
        Row: {
          occupies: unknown
          organization_id: string | null
          resource_id: string | null
        }
        Insert: {
          occupies?: unknown
          organization_id?: string | null
          resource_id?: string | null
        }
        Update: {
          occupies?: unknown
          organization_id?: string | null
          resource_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_items_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_display_name: string; p_token: string }
        Returns: string
      }
      add_checklist_item: {
        Args: { p_label: string; p_position: number; p_work_item_id: string }
        Returns: string
      }
      add_member_by_email: {
        Args: {
          p_display_name: string
          p_email: string
          p_organization_id: string
          p_role_id: string
        }
        Returns: string
      }
      add_operating_hours: {
        Args: {
          p_closes_at: string
          p_day_of_week: number
          p_opens_at: string
          p_organization_id: string
        }
        Returns: string
      }
      add_runtime_mapping: {
        Args: {
          p_feature_id: string
          p_mapping_kind: string
          p_mapping_value: string
          p_note?: string
        }
        Returns: string
      }
      add_type_checklist_item: {
        Args: {
          p_label: string
          p_organization_id: string
          p_position: number
          p_type_id: string
        }
        Returns: string
      }
      add_work_item_priced_line: {
        Args: {
          p_price_book_item_id: string
          p_quantity: number
          p_work_item_id: string
        }
        Returns: string
      }
      apply_import_run: {
        Args: { p_organization_id: string; p_run_id: string }
        Returns: undefined
      }
      apply_platform_subscription_event: {
        Args: {
          p_cancel_at_period_end: boolean
          p_canceled_at: number
          p_currency: string
          p_current_period_end: number
          p_current_period_start: number
          p_customer_reference: string
          p_event_reference: string
          p_event_type: string
          p_price_reference: string
          p_provider?: string
          p_status: string
          p_subscription_reference: string
        }
        Returns: string
      }
      assign_phone_number: {
        Args: {
          p_default?: boolean
          p_member_id?: string
          p_organization_id: string
          p_phone_number_id: string
          p_resource_id?: string
        }
        Returns: string
      }
      assign_role: {
        Args: { p_membership_id: string; p_role_id: string }
        Returns: undefined
      }
      begin_external_card_payment: {
        Args: { p_invoice_id: string; p_provider: string }
        Returns: {
          account_id: string
          currency: string
          outstanding_minor: number
          request_id: string
        }[]
      }
      begin_import_run: {
        Args: { p_mapping_id: string; p_organization_id: string }
        Returns: string
      }
      begin_platform_billing_portal_session: {
        Args: { p_organization_id: string }
        Returns: string
      }
      begin_provider_binding: {
        Args: { p_organization_id: string; p_provider_key: string }
        Returns: string
      }
      booking_organization: { Args: { p_slug: string }; Returns: string }
      change_customer_stage: {
        Args: {
          p_customer_id: string
          p_organization_id: string
          p_stage_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          custom: Json
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          stage_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_work_item_status: {
        Args: { p_status_id: string; p_work_item_id: string }
        Returns: undefined
      }
      claim_portal_invite: { Args: { p_token: string }; Returns: string }
      clear_plan_feature_override: {
        Args: { p_feature_id: string; p_plan_id: string }
        Returns: undefined
      }
      confirm_external_card_payment: {
        Args: { p_provider_reference: string; p_request_id: string }
        Returns: undefined
      }
      consume_public_communication_rate_limit: {
        Args: { p_site_id: string; p_visitor_key: string }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      create_asset: {
        Args: {
          p_custom: Json
          p_customer_id: string
          p_location_id: string
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      create_booking: {
        Args: {
          p_email: string
          p_name: string
          p_organization_id: string
          p_phone: string
          p_resource_id: string
          p_starts_at: string
          p_type_id: string
        }
        Returns: string
      }
      create_customer: {
        Args: {
          p_custom: Json
          p_email: string
          p_name: string
          p_organization_id: string
          p_phone: string
        }
        Returns: string
      }
      create_document: {
        Args: {
          p_asset_id: string
          p_customer_id: string
          p_file_name: string
          p_location_id: string
          p_mime_type: string
          p_organization_id: string
          p_size_bytes: number
          p_storage_path: string
          p_work_item_id: string
        }
        Returns: string
      }
      create_field_definition: {
        Args: {
          p_entity_type: string
          p_key: string
          p_kind: string
          p_label: string
          p_options: string[]
          p_organization_id: string
          p_required: boolean
        }
        Returns: string
      }
      create_location: {
        Args: {
          p_access_notes: string
          p_address: string
          p_custom: Json
          p_label: string
          p_organization_id: string
        }
        Returns: string
      }
      create_organization: {
        Args: {
          p_capabilities: string[]
          p_currency?: string
          p_display_name: string
          p_name: string
          p_role: string
          p_timezone: string
        }
        Returns: string
      }
      create_plan: {
        Args: {
          p_billable: boolean
          p_description: string
          p_display_order?: number
          p_key: string
          p_kind: string
          p_label: string
          p_sale_status: string
        }
        Returns: string
      }
      create_portal_invite: { Args: { p_customer_id: string }; Returns: string }
      create_price_book_item: {
        Args: {
          p_name: string
          p_organization_id: string
          p_unit: string
          p_unit_amount_minor: number
        }
        Returns: string
      }
      create_public_homepage_draft: {
        Args: { p_organization_id: string }
        Returns: string
      }
      create_resource: {
        Args: { p_custom: Json; p_name: string; p_organization_id: string }
        Returns: string
      }
      create_role: {
        Args: {
          p_capabilities: string[]
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      create_work_item: {
        Args: {
          p_asset_id: string
          p_custom: Json
          p_customer_id: string
          p_location_id: string
          p_organization_id: string
          p_resource_id: string
          p_status_id: string
          p_title: string
        }
        Returns: string
      }
      create_work_item_status: {
        Args: {
          p_name: string
          p_organization_id: string
          p_position: number
          p_type_id: string
        }
        Returns: string
      }
      create_work_item_transition: {
        Args: {
          p_from_status_id: string
          p_organization_id: string
          p_to_status_id: string
          p_type_id: string
        }
        Returns: string
      }
      create_work_item_type: {
        Args: { p_name: string; p_organization_id: string }
        Returns: string
      }
      credit_balance: { Args: { p_organization_id: string }; Returns: number }
      customers_not_contacted: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: {
          customer_id: string
          days_since: number
          email: string
          last_activity: string
          last_activity_local: string
          name: string
          phone: string
          time_zone: string
        }[]
      }
      disconnect_integration: {
        Args: { p_connection_id: string; p_organization_id: string }
        Returns: undefined
      }
      end_support_session: { Args: { p_id: string }; Returns: undefined }
      external_card_payment_availability: {
        Args: { p_invoice_id: string; p_provider: string }
        Returns: {
          account_id: string
          currency: string
          outstanding_minor: number
        }[]
      }
      grant_plan_module: {
        Args: { p_module_id: string; p_plan_id: string }
        Returns: undefined
      }
      grant_plan_product: {
        Args: { p_plan_id: string; p_product_key: string }
        Returns: undefined
      }
      invite_member: {
        Args: { p_email: string; p_organization_id: string; p_role_id: string }
        Returns: string
      }
      invoiced_and_incurred: {
        Args: {
          p_customer_id?: string
          p_from?: string
          p_grouping: string
          p_location_id?: string
          p_organization_id: string
          p_resource_id?: string
          p_to?: string
        }
        Returns: {
          currency: string
          group_id: string
          group_label: string
          incurred_minor: number
          invoiced_minor: number
          margin_minor: number
        }[]
      }
      issue_invoice: {
        Args: { p_due_at: string; p_issued_at: string; p_work_item_id: string }
        Returns: string
      }
      launch_organization: { Args: { p_id: string }; Returns: undefined }
      link_customer_location: {
        Args: {
          p_customer_id: string
          p_location_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      module_commercial_state: {
        Args: { p_organization_id: string }
        Returns: {
          module_key: string
          paid: boolean
          period_end: string
          wanted: boolean
        }[]
      }
      open_call: {
        Args: {
          p_conference_name: string
          p_customer_id: string
          p_from_number: string
          p_organization_id: string
          p_to_number: string
        }
        Returns: string
      }
      organization_commercial_summary: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: {
          customer_charge_minor: number
          customer_currency: string
          margin_minor: number
          meter_id: string
          provider_cost_minor: number
          provider_currency: string
          quantity: number
        }[]
      }
      organization_effective_entitlements: {
        Args: { p_at?: string; p_organization_id: string }
        Returns: {
          feature_id: string
          plan_id: string
          plan_key: string
        }[]
      }
      organization_effective_quotas: {
        Args: { p_at?: string; p_organization_id: string }
        Returns: {
          allowance_key: string
          hard_limit: number
          included_quantity: number
          label: string
          meter_id: string
          overage_policy: string
          overridden: boolean
          period: string
          plan_key: string
          service_class: string
          unit: string
        }[]
      }
      organization_launch_blockers: {
        Args: { p_id: string }
        Returns: string[]
      }
      organization_plan_price: {
        Args: { p_at?: string; p_organization_id: string; p_plan_id: string }
        Returns: {
          amount_minor: number
          currency: string
          source: string
        }[]
      }
      organization_usage_detail: {
        Args: { p_organization_id: string }
        Returns: {
          customer_charge_micros: number
          customer_currency: string
          estimated_cost_micros: number
          estimated_currency: string
          meter_id: string
          occurred_at: string
          provider_key: string
          quantity: number
          reconciled_at: string
          reconciled_cost_micros: number
          reconciled_currency: string
          usage_event_id: string
        }[]
      }
      places_to_watch: {
        Args: never
        Returns: {
          latitude: number
          location_id: string
          longitude: number
          metric: string
          needed_at: string
        }[]
      }
      plan_entitled_features: {
        Args: { p_plan_id: string }
        Returns: {
          feature_id: string
        }[]
      }
      platform_meter_observations: {
        Args: never
        Returns: {
          meter_id: string
          usage_event_count: number
        }[]
      }
      provision_organization: {
        Args: {
          p_capabilities: string[]
          p_currency: string
          p_display_name: string
          p_name: string
          p_owner_email: string
          p_role: string
          p_timezone: string
        }
        Returns: string
      }
      public_assistant_deployment: {
        Args: { p_site_id: string }
        Returns: Json
      }
      public_homepage_editor_state: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      public_homepage_preview: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: Json
      }
      publish_public_homepage_revision: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: undefined
      }
      published_gold_homepage: { Args: never; Returns: Json }
      queued_messages: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          channel: string
          id: string
          recipient: string
          subject_line: string
        }[]
      }
      record_call_event: {
        Args: {
          p_duration: number
          p_external_id: string
          p_payload: Json
          p_payload_hash: string
          p_raw_status: string
          p_recording_url: string
          p_source: string
          p_status: string
        }
        Returns: string
      }
      record_call_outcome: {
        Args: {
          p_call_id: string
          p_duration_seconds: number
          p_note: string
          p_organization_id: string
          p_outcome_id: string
          p_status: string
        }
        Returns: {
          conference_name: string | null
          created_at: string
          created_by: string
          customer_id: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          external_id: string | null
          from_number: string
          id: string
          note: string
          organization_id: string
          outcome_id: string | null
          recording_url: string | null
          started_at: string
          status: string
          to_number: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_commercial_term: {
        Args: {
          p_currency?: string
          p_note?: string
          p_organization_id: string
          p_period_end: string
          p_period_start: string
          p_price_minor: number
          p_product_key: string
          p_quantity?: number
        }
        Returns: string
      }
      record_external_readings: {
        Args: { p_location_id: string; p_readings: Json }
        Returns: number
      }
      record_integration_connection: {
        Args: {
          p_account_label: string
          p_connector_key: string
          p_organization_id: string
        }
        Returns: string
      }
      record_integration_mapping: {
        Args: {
          p_dedupe_key: string
          p_mapping: Json
          p_organization_id: string
          p_resource_id: string
          p_target_entity: string
        }
        Returns: string
      }
      record_integration_resource: {
        Args: {
          p_connection_id: string
          p_display_name: string
          p_external_id: string
          p_metadata: Json
          p_organization_id: string
          p_resource_type: string
          p_storage_path: string
        }
        Returns: string
      }
      record_message_delivery: {
        Args: { p_detail: string; p_id: string; p_sent: boolean }
        Returns: undefined
      }
      record_organization_email_domain: {
        Args: { p_domain: string; p_organization_id: string }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount_minor: number
          p_invoice_id: string
          p_note: string
          p_provider: string
          p_provider_reference: string
          p_received_at: string
        }
        Returns: string
      }
      record_plan_agreement: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_effective_from?: string
          p_note?: string
          p_organization_id: string
          p_plan_id: string
        }
        Returns: string
      }
      record_plan_assignment: {
        Args: {
          p_note?: string
          p_organization_id: string
          p_period_end: string
          p_period_start: string
          p_plan_id: string
        }
        Returns: string
      }
      record_plan_price: {
        Args: {
          p_amount_minor: number
          p_billing_interval: string
          p_currency: string
          p_effective_from?: string
          p_note?: string
          p_plan_id: string
          p_source?: string
          p_source_url?: string
        }
        Returns: string
      }
      record_plan_provider_price: {
        Args: {
          p_environment: string
          p_plan_price_id: string
          p_price_reference: string
          p_product_reference: string
          p_provider?: string
        }
        Returns: string
      }
      record_plan_quota_override: {
        Args: {
          p_allowance_key: string
          p_effective_from?: string
          p_hard_limit?: number
          p_included_quantity: number
          p_note?: string
          p_organization_id: string
          p_plan_id: string
        }
        Returns: string
      }
      record_platform_billing_notice: {
        Args: {
          p_customer_reference: string
          p_event_reference: string
          p_event_type: string
          p_provider?: string
        }
        Returns: string
      }
      record_product_price: {
        Args: {
          p_amount_minor: number
          p_approval_state?: string
          p_billing_interval?: string
          p_currency: string
          p_effective_from?: string
          p_note?: string
          p_product_key: string
          p_source?: string
        }
        Returns: string
      }
      record_provider_payment: {
        Args: {
          p_amount_minor: number
          p_provider: string
          p_provider_reference: string
          p_request_id: string
        }
        Returns: string
      }
      record_provider_rate: {
        Args: {
          p_approval_state?: string
          p_currency: string
          p_meter_id: string
          p_note?: string
          p_provider_key: string
          p_source: string
          p_source_url?: string
          p_unit_amount_micros: number
        }
        Returns: string
      }
      record_provider_resource: {
        Args: {
          p_config?: Json
          p_external_id: string
          p_organization_id: string
          p_provider_key: string
          p_resource_type: string
          p_status?: string
        }
        Returns: string
      }
      record_public_communication: {
        Args: { p_body: string; p_site_id: string; p_visitor_key: string }
        Returns: string
      }
      record_public_communication_reply: {
        Args: {
          p_body: string
          p_handoff?: boolean
          p_site_id: string
          p_visitor_key: string
        }
        Returns: undefined
      }
      record_retail_rate: {
        Args: {
          p_approval_state?: string
          p_currency: string
          p_meter_id: string
          p_note?: string
          p_source: string
          p_source_url?: string
          p_unit_amount_micros: number
        }
        Returns: string
      }
      record_usage_reconciliation: {
        Args: {
          p_note?: string
          p_provider_currency: string
          p_provider_reference?: string
          p_reconciled_provider_cost_micros: number
          p_source: string
          p_usage_event_id: string
        }
        Returns: string
      }
      record_work_item_cost: {
        Args: {
          p_amount_minor: number
          p_description: string
          p_incurred_at: string
          p_work_item_id: string
        }
        Returns: string
      }
      record_work_item_time: {
        Args: {
          p_ended_at: string
          p_note: string
          p_resource_id: string
          p_started_at: string
          p_work_item_id: string
        }
        Returns: string
      }
      release_phone_number_assignment: {
        Args: { p_assignment_id: string; p_organization_id: string }
        Returns: undefined
      }
      remove_operating_hours: { Args: { p_id: string }; Returns: undefined }
      remove_plan_quota: {
        Args: { p_allowance_key: string; p_plan_id: string }
        Returns: undefined
      }
      remove_runtime_mapping: {
        Args: { p_mapping_id: string }
        Returns: undefined
      }
      remove_type_checklist_item: { Args: { p_id: string }; Returns: undefined }
      remove_work_item_priced_line: {
        Args: { p_id: string }
        Returns: undefined
      }
      rename_work_item_type: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      request_workflow_review: {
        Args: {
          p_business_name: string
          p_business_type: string
          p_context: string
          p_email: string
          p_name: string
          p_phone: string
          p_team_size: string
        }
        Returns: undefined
      }
      resolve_effective_outbound_identity: {
        Args: { p_organization_id: string }
        Returns: string
      }
      retail_rate_at: {
        Args: { p_at?: string; p_currency: string; p_meter_id: string }
        Returns: number
      }
      revoke_invitation: { Args: { p_id: string }; Returns: undefined }
      revoke_plan_module: {
        Args: { p_module_id: string; p_plan_id: string }
        Returns: undefined
      }
      revoke_plan_product: {
        Args: { p_plan_id: string; p_product_key: string }
        Returns: undefined
      }
      run_due_automations: { Args: never; Returns: number }
      schedule_ahead: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: {
          customer: string
          ends_local: string
          resource: string
          starts_at: string
          starts_local: string
          status: string
          time_zone: string
          title: string
          work_item_id: string
        }[]
      }
      schedule_work_item: {
        Args: {
          p_ends_at: string
          p_resource_id: string
          p_starts_at: string
          p_work_item_id: string
        }
        Returns: undefined
      }
      set_brand_logo: {
        Args: { p_logo_path: string; p_organization_id: string }
        Returns: undefined
      }
      set_brand_settings: {
        Args: {
          p_accent: string
          p_body_font: string
          p_heading_font: string
          p_organization_id: string
        }
        Returns: undefined
      }
      set_calling_number: {
        Args: { p_number: string; p_organization_id: string }
        Returns: undefined
      }
      set_checklist_item_done: {
        Args: { p_checklist_item_id: string; p_done: boolean }
        Returns: undefined
      }
      set_organization_profile: {
        Args: {
          p_address: string
          p_contact_email: string
          p_contact_phone: string
          p_display_name: string
          p_intro: string
          p_organization_id: string
          p_tagline: string
        }
        Returns: undefined
      }
      set_plan_feature_override: {
        Args: { p_feature_id: string; p_included: boolean; p_plan_id: string }
        Returns: undefined
      }
      set_plan_quota: {
        Args: {
          p_allowance_key: string
          p_display_order?: number
          p_hard_limit?: number
          p_included_quantity: number
          p_label: string
          p_meter_id?: string
          p_overage_policy?: string
          p_period?: string
          p_plan_id: string
          p_service_class?: string
          p_unit: string
        }
        Returns: string
      }
      set_provider_binding_status: {
        Args: {
          p_error?: string
          p_external_account_id?: string
          p_organization_id: string
          p_provider_key: string
          p_status: string
        }
        Returns: undefined
      }
      set_provider_resource_status: {
        Args: {
          p_error?: string
          p_organization_id: string
          p_resource_id: string
          p_status: string
        }
        Returns: undefined
      }
      set_type_bookable: {
        Args: {
          p_duration_minutes: number
          p_id: string
          p_price_item_id: string
          p_status_id: string
        }
        Returns: undefined
      }
      set_user_phone_number_preference: {
        Args: { p_organization_id: string; p_phone_number_id: string }
        Returns: undefined
      }
      stage_import_rows: {
        Args: { p_organization_id: string; p_rows: Json; p_run_id: string }
        Returns: number
      }
      start_support_session: {
        Args: { p_organization_id: string; p_reason?: string }
        Returns: string
      }
      store_integration_secret: {
        Args: {
          p_connection_id: string
          p_organization_id: string
          p_secret: string
        }
        Returns: string
      }
      store_provider_secret: {
        Args: {
          p_organization_id: string
          p_resource_id: string
          p_secret: string
        }
        Returns: string
      }
      submit_public_homepage_revision: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: undefined
      }
      sync_phone_number: {
        Args: {
          p_e164: string
          p_label?: string
          p_organization_id: string
          p_provider_resource_id: string
          p_status?: string
        }
        Returns: string
      }
      time_committed: {
        Args: {
          p_customer_id?: string
          p_from?: string
          p_grouping: string
          p_location_id?: string
          p_organization_id: string
          p_resource_id?: string
          p_to?: string
        }
        Returns: {
          group_id: string
          group_label: string
          minutes: number
        }[]
      }
      unschedule_work_item: {
        Args: { p_work_item_id: string }
        Returns: undefined
      }
      update_catalog_feature: {
        Args: {
          p_ai_powered: boolean
          p_description: string
          p_display_order: number
          p_feature_id: string
          p_implementation_state: string
          p_label: string
          p_lifecycle: string
          p_meter_ids: string[]
          p_metered: boolean
          p_packaging_default: string
          p_provider_capabilities: string[]
          p_sale_status: string
        }
        Returns: undefined
      }
      update_catalog_module: {
        Args: {
          p_description: string
          p_display_order: number
          p_label: string
          p_module_id: string
        }
        Returns: undefined
      }
      update_catalog_product: {
        Args: {
          p_description: string
          p_display_order: number
          p_key: string
          p_label: string
          p_lifecycle: string
          p_sale_status: string
        }
        Returns: undefined
      }
      update_customer: {
        Args: {
          p_custom: Json
          p_customer_id: string
          p_email: string
          p_name: string
          p_organization_id: string
          p_phone: string
          p_stage_id: string
        }
        Returns: undefined
      }
      update_field_definition: {
        Args: {
          p_id: string
          p_label: string
          p_options: string[]
          p_position: number
          p_required: boolean
        }
        Returns: undefined
      }
      update_organization: {
        Args: {
          p_buffer_minutes: number
          p_currency: string
          p_id: string
          p_name: string
          p_slug: string
          p_timezone: string
        }
        Returns: undefined
      }
      update_plan: {
        Args: {
          p_billable: boolean
          p_description: string
          p_display_order: number
          p_label: string
          p_plan_id: string
          p_sale_status: string
        }
        Returns: undefined
      }
      update_platform_product: {
        Args: {
          p_description: string
          p_display_order: number
          p_label: string
          p_product_key: string
          p_sale_status: string
        }
        Returns: undefined
      }
      update_price_book_item: {
        Args: {
          p_id: string
          p_name: string
          p_unit: string
          p_unit_amount_minor: number
        }
        Returns: undefined
      }
      update_public_homepage_draft: {
        Args: {
          p_organization_id: string
          p_revision_id: string
          p_sections: Json
          p_seo_description: string
          p_seo_title: string
        }
        Returns: undefined
      }
      update_role: {
        Args: { p_capabilities: string[]; p_name: string; p_role_id: string }
        Returns: undefined
      }
      update_work_item: {
        Args: {
          p_asset_id: string
          p_custom: Json
          p_customer_id: string
          p_id: string
          p_location_id: string
          p_title: string
        }
        Returns: undefined
      }
      update_work_item_status: {
        Args: {
          p_id: string
          p_marks_complete: boolean
          p_name: string
          p_position: number
          p_releases_resource: boolean
        }
        Returns: undefined
      }
      usable_modules: { Args: { p_organization_id: string }; Returns: string[] }
      work_at_risk: {
        Args: { p_organization_id: string }
        Returns: {
          customer: string
          ends_local: string
          reason: string
          resource: string
          scheduled_from: string
          scheduled_to: string
          starts_local: string
          status: string
          time_zone: string
          title: string
          work_item_id: string
        }[]
      }
      work_marked_complete: {
        Args: {
          p_customer_id?: string
          p_from?: string
          p_grouping: string
          p_location_id?: string
          p_organization_id: string
          p_resource_id?: string
          p_to?: string
        }
        Returns: {
          group_id: string
          group_label: string
          jobs: number
        }[]
      }
    }
    Enums: {
      communication_channel: "voice" | "sms" | "email"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      communication_channel: ["voice", "sms", "email"],
    },
  },
} as const

