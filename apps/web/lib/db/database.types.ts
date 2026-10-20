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
      account_appearance_preferences: {
        Row: {
          appearance: string
          density: string | null
          motion: string | null
          preset: string | null
          shape: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          appearance?: string
          density?: string | null
          motion?: string | null
          preset?: string | null
          shape?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          appearance?: string
          density?: string | null
          motion?: string | null
          preset?: string | null
          shape?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_profiles: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          administrative_area: string | null
          avatar: string | null
          city: string | null
          country_code: string | null
          created_at: string
          family_name: string
          given_name: string
          locale: string
          phone_e164: string | null
          postal_code: string | null
          preferred_name: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          administrative_area?: string | null
          avatar?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          family_name?: string
          given_name?: string
          locale?: string
          phone_e164?: string | null
          postal_code?: string | null
          preferred_name?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          administrative_area?: string | null
          avatar?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          family_name?: string
          given_name?: string
          locale?: string
          phone_e164?: string | null
          postal_code?: string | null
          preferred_name?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          last_activity_at: string
          organization_id: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          last_activity_at?: string
          organization_id: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          last_activity_at?: string
          organization_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_run_documents: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          organization_id: string
          run_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document_id: string
          organization_id: string
          run_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          organization_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_documents_document_fkey"
            columns: ["organization_id", "created_by", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["organization_id", "agent_user_id", "id"]
          },
          {
            foreignKeyName: "agent_run_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_documents_run_fkey"
            columns: ["organization_id", "created_by", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["organization_id", "created_by", "id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          action_detail: string | null
          action_outcome: string | null
          action_taken_at: string | null
          answer: string
          answered_by: string
          assistant_deployment_id: string | null
          assistant_version_id: string | null
          conversation_id: string
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
          assistant_deployment_id?: string | null
          assistant_version_id?: string | null
          conversation_id: string
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
          assistant_deployment_id?: string | null
          assistant_version_id?: string | null
          conversation_id?: string
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
            foreignKeyName: "agent_runs_conversation_fkey"
            columns: ["organization_id", "created_by", "conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["organization_id", "created_by", "id"]
          },
          {
            foreignKeyName: "agent_runs_organization_id_assistant_deployment_id_fkey"
            columns: ["organization_id", "assistant_deployment_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_deployments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "agent_runs_organization_id_assistant_version_id_fkey"
            columns: ["organization_id", "assistant_version_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_versions"
            referencedColumns: ["organization_id", "id"]
          },
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
          configuration: Json
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
          version_id: string | null
        }
        Insert: {
          assistant_id: string
          configuration?: Json
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
          version_id?: string | null
        }
        Update: {
          assistant_id?: string
          configuration?: Json
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
          version_id?: string | null
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
          {
            foreignKeyName: "ai_assistant_deployments_organization_id_version_id_fkey"
            columns: ["organization_id", "version_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_assistant_evaluations: {
        Row: {
          answer: string
          assistant_id: string
          created_at: string
          created_by: string
          criterion: string
          detail: string | null
          id: string
          organization_id: string
          outcome: string
          scenario: string
          verdict: string | null
          version_id: string
        }
        Insert: {
          answer: string
          assistant_id: string
          created_at?: string
          created_by?: string
          criterion: string
          detail?: string | null
          id?: string
          organization_id: string
          outcome: string
          scenario: string
          verdict?: string | null
          version_id: string
        }
        Update: {
          answer?: string
          assistant_id?: string
          created_at?: string
          created_by?: string
          criterion?: string
          detail?: string | null
          id?: string
          organization_id?: string
          outcome?: string
          scenario?: string
          verdict?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_evaluations_organization_id_assistant_id_fkey"
            columns: ["organization_id", "assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_assistant_evaluations_organization_id_version_id_fkey"
            columns: ["organization_id", "version_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_versions"
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
      ai_assistant_versions: {
        Row: {
          assistant_id: string
          configuration: Json
          created_at: string
          created_by: string
          id: string
          instructions: string
          knowledge_site_ids: string[]
          name: string
          organization_id: string
          version_number: number
        }
        Insert: {
          assistant_id: string
          configuration: Json
          created_at?: string
          created_by: string
          id?: string
          instructions: string
          knowledge_site_ids?: string[]
          name: string
          organization_id: string
          version_number: number
        }
        Update: {
          assistant_id?: string
          configuration?: Json
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string
          knowledge_site_ids?: string[]
          name?: string
          organization_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_versions_organization_id_assistant_id_fkey"
            columns: ["organization_id", "assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_assistants: {
        Row: {
          configuration: Json
          created_at: string
          created_by: string
          draft_number: number
          id: string
          instructions: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          created_by: string
          draft_number?: number
          id?: string
          instructions?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          created_by?: string
          draft_number?: number
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
      assistant_resource_grants: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          organization_id: string
          resource_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          id?: string
          organization_id: string
          resource_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          organization_id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_resource_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_resource_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_resource_grants_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: true
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      automation_actions: {
        Row: {
          action_kind: string
          channel: string | null
          created_at: string
          created_by: string
          grant_id: string | null
          id: string
          organization_id: string
          position: number
          rule_id: string
          shift_minutes: number | null
          status_id: string | null
          template_id: string | null
          tool_arguments: Json | null
          tool_label: string | null
          work_item_type_id: string | null
        }
        Insert: {
          action_kind: string
          channel?: string | null
          created_at?: string
          created_by: string
          grant_id?: string | null
          id?: string
          organization_id: string
          position?: number
          rule_id: string
          shift_minutes?: number | null
          status_id?: string | null
          template_id?: string | null
          tool_arguments?: Json | null
          tool_label?: string | null
          work_item_type_id?: string | null
        }
        Update: {
          action_kind?: string
          channel?: string | null
          created_at?: string
          created_by?: string
          grant_id?: string | null
          id?: string
          organization_id?: string
          position?: number
          rule_id?: string
          shift_minutes?: number | null
          status_id?: string | null
          template_id?: string | null
          tool_arguments?: Json | null
          tool_label?: string | null
          work_item_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_actions_grant_same_org"
            columns: ["organization_id", "grant_id"]
            isOneToOne: false
            referencedRelation: "integration_tool_grants"
            referencedColumns: ["organization_id", "id"]
          },
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
      calendar_events: {
        Row: {
          created_at: string
          created_by: string
          ends_at: string
          id: string
          notes: string | null
          organization_id: string
          starts_at: string
          status: string
          title: string
          workspace: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_at: string
          id?: string
          notes?: string | null
          organization_id: string
          starts_at: string
          status?: string
          title: string
          workspace: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          starts_at?: string
          status?: string
          title?: string
          workspace?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
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
          duration_seconds: number | null
          external_id: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          membership_id: string | null
          muted: boolean
          on_hold: boolean
          organization_id: string
          party: string
          status: string
        }
        Insert: {
          call_id: string
          created_at?: string
          duration_seconds?: number | null
          external_id?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          membership_id?: string | null
          muted?: boolean
          on_hold?: boolean
          organization_id: string
          party: string
          status?: string
        }
        Update: {
          call_id?: string
          created_at?: string
          duration_seconds?: number | null
          external_id?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          membership_id?: string | null
          muted?: boolean
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
            foreignKeyName: "call_participants_membership_same_org"
            columns: ["organization_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
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
          answered_at: string | null
          conference_name: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          note: string
          organization_id: string
          outcome_id: string | null
          phone_number_id: string | null
          recording_available_at: string | null
          recording_url: string | null
          started_at: string
          status: string
          to_number: string
        }
        Insert: {
          answered_at?: string | null
          conference_name?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          note?: string
          organization_id: string
          outcome_id?: string | null
          phone_number_id?: string | null
          recording_available_at?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          to_number: string
        }
        Update: {
          answered_at?: string | null
          conference_name?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          note?: string
          organization_id?: string
          outcome_id?: string | null
          phone_number_id?: string | null
          recording_available_at?: string | null
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
          {
            foreignKeyName: "calls_phone_number_same_org"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_number_readiness"
            referencedColumns: ["organization_id", "phone_number_id"]
          },
          {
            foreignKeyName: "calls_phone_number_same_org"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      client_tenant_relationships: {
        Row: {
          authority_basis: string
          created_at: string
          created_by: string
          customer_id: string
          ended_at: string | null
          ended_by: string | null
          id: string
          organization_id: string
          origin: string
          originating_handoff_id: string | null
          status: string
          tenant_organization_id: string
        }
        Insert: {
          authority_basis: string
          created_at?: string
          created_by: string
          customer_id: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          organization_id: string
          origin: string
          originating_handoff_id?: string | null
          status?: string
          tenant_organization_id: string
        }
        Update: {
          authority_basis?: string
          created_at?: string
          created_by?: string
          customer_id?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          organization_id?: string
          origin?: string
          originating_handoff_id?: string | null
          status?: string
          tenant_organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tenant_relationships_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_tenant_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tenant_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tenant_relationships_organization_id_originating_ha_fkey"
            columns: ["organization_id", "originating_handoff_id"]
            isOneToOne: false
            referencedRelation: "customer_proposal_handoffs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_tenant_relationships_tenant_organization_id_fkey"
            columns: ["tenant_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tenant_relationships_tenant_organization_id_fkey"
            columns: ["tenant_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_draft_scenario_addons: {
        Row: {
          addon_plan_id: string
          version_id: string
        }
        Insert: {
          addon_plan_id: string
          version_id: string
        }
        Update: {
          addon_plan_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_draft_scenario_addons_addon_plan_id_fkey"
            columns: ["addon_plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_draft_scenario_addons_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "commercial_draft_scenario_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_draft_scenario_direct_costs: {
        Row: {
          amount_minor: number
          currency: string
          id: string
          label: string
          note: string
          version_id: string
        }
        Insert: {
          amount_minor: number
          currency: string
          id?: string
          label: string
          note?: string
          version_id: string
        }
        Update: {
          amount_minor?: number
          currency?: string
          id?: string
          label?: string
          note?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_draft_scenario_direct_costs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "commercial_draft_scenario_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_draft_scenario_inputs: {
        Row: {
          allowance_key: string
          expected_quantity: number | null
          meter_id: string | null
          utilization: number | null
          version_id: string
        }
        Insert: {
          allowance_key: string
          expected_quantity?: number | null
          meter_id?: string | null
          utilization?: number | null
          version_id: string
        }
        Update: {
          allowance_key?: string
          expected_quantity?: number | null
          meter_id?: string | null
          utilization?: number | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_draft_scenario_inputs_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_draft_scenario_inputs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "commercial_draft_scenario_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_draft_scenario_versions: {
        Row: {
          candidate_prices_minor: number[]
          currency: string
          expected_resource_count: number | null
          expected_seats: number | null
          id: string
          plan_id: string
          recorded_at: string
          recorded_by: string
          revision: number
          scenario_id: string
        }
        Insert: {
          candidate_prices_minor: number[]
          currency: string
          expected_resource_count?: number | null
          expected_seats?: number | null
          id?: string
          plan_id: string
          recorded_at?: string
          recorded_by: string
          revision: number
          scenario_id: string
        }
        Update: {
          candidate_prices_minor?: number[]
          currency?: string
          expected_resource_count?: number | null
          expected_seats?: number | null
          id?: string
          plan_id?: string
          recorded_at?: string
          recorded_by?: string
          revision?: number
          scenario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_draft_scenario_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_draft_scenario_versions_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "commercial_draft_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_draft_scenarios: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          notes: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          notes?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          notes?: string
        }
        Relationships: []
      }
      communication_entries: {
        Row: {
          body: string
          channel: string
          created_at: string
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
      communication_route_targets: {
        Row: {
          created_at: string
          id: string
          member_id: string
          organization_id: string
          position: number
          route_id: string
          slot: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          organization_id: string
          position?: number
          route_id: string
          slot: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          organization_id?: string
          position?: number
          route_id?: string
          slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_route_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_route_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_route_targets_organization_id_member_id_fkey"
            columns: ["organization_id", "member_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_route_targets_organization_id_route_id_fkey"
            columns: ["organization_id", "route_id"]
            isOneToOne: false
            referencedRelation: "communication_routes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_routes: {
        Row: {
          callback_affinity_enabled: boolean
          created_at: string
          created_by: string | null
          destination_external_number: string | null
          destination_route_id: string | null
          destination_type: string
          enabled: boolean
          fallback_external_number: string | null
          fallback_message: string | null
          fallback_route_id: string | null
          fallback_type: string
          id: string
          name: string
          number_id: string | null
          organization_id: string
          ring_strategy: string
          ring_timeout_seconds: number
          round_robin_cursor: number
          updated_at: string
          when_mode: string
        }
        Insert: {
          callback_affinity_enabled?: boolean
          created_at?: string
          created_by?: string | null
          destination_external_number?: string | null
          destination_route_id?: string | null
          destination_type: string
          enabled?: boolean
          fallback_external_number?: string | null
          fallback_message?: string | null
          fallback_route_id?: string | null
          fallback_type?: string
          id?: string
          name: string
          number_id?: string | null
          organization_id: string
          ring_strategy?: string
          ring_timeout_seconds?: number
          round_robin_cursor?: number
          updated_at?: string
          when_mode?: string
        }
        Update: {
          callback_affinity_enabled?: boolean
          created_at?: string
          created_by?: string | null
          destination_external_number?: string | null
          destination_route_id?: string | null
          destination_type?: string
          enabled?: boolean
          fallback_external_number?: string | null
          fallback_message?: string | null
          fallback_route_id?: string | null
          fallback_type?: string
          id?: string
          name?: string
          number_id?: string | null
          organization_id?: string
          ring_strategy?: string
          ring_timeout_seconds?: number
          round_robin_cursor?: number
          updated_at?: string
          when_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_routes_organization_id_destination_route_id_fkey"
            columns: ["organization_id", "destination_route_id"]
            isOneToOne: false
            referencedRelation: "communication_routes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_routes_organization_id_fallback_route_id_fkey"
            columns: ["organization_id", "fallback_route_id"]
            isOneToOne: false
            referencedRelation: "communication_routes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_routes_organization_id_number_id_fkey"
            columns: ["organization_id", "number_id"]
            isOneToOne: false
            referencedRelation: "phone_number_readiness"
            referencedColumns: ["organization_id", "phone_number_id"]
          },
          {
            foreignKeyName: "communication_routes_organization_id_number_id_fkey"
            columns: ["organization_id", "number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_threads: {
        Row: {
          assistant_deployment_id: string | null
          assistant_version_id: string | null
          channel: string
          claimed_by: string | null
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
          assistant_deployment_id?: string | null
          assistant_version_id?: string | null
          channel: string
          claimed_by?: string | null
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
          assistant_deployment_id?: string | null
          assistant_version_id?: string | null
          channel?: string
          claimed_by?: string | null
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
            foreignKeyName: "communication_threads_organization_id_assistant_deployment_fkey"
            columns: ["organization_id", "assistant_deployment_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_deployments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_assistant_version_id_fkey"
            columns: ["organization_id", "assistant_version_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_versions"
            referencedColumns: ["organization_id", "id"]
          },
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
      conversations: {
        Row: {
          assignee_membership_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          email_identity_id: string | null
          external_email: string | null
          external_number: string | null
          id: string
          last_message_at: string
          last_message_preview: string
          organization_id: string
          phone_number_id: string | null
          status: string
          status_changed_at: string
          subject: string | null
          unread: boolean
        }
        Insert: {
          assignee_membership_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          email_identity_id?: string | null
          external_email?: string | null
          external_number?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string
          organization_id: string
          phone_number_id?: string | null
          status?: string
          status_changed_at?: string
          subject?: string | null
          unread?: boolean
        }
        Update: {
          assignee_membership_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          email_identity_id?: string | null
          external_email?: string | null
          external_number?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string
          organization_id?: string
          phone_number_id?: string | null
          status?: string
          status_changed_at?: string
          subject?: string | null
          unread?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_fk"
            columns: ["organization_id", "assignee_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_email_identity_fk"
            columns: ["organization_id", "email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_phone_number_id_fkey"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_number_readiness"
            referencedColumns: ["organization_id", "phone_number_id"]
          },
          {
            foreignKeyName: "conversations_organization_id_phone_number_id_fkey"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      crm_follow_ups: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          customer_id: string
          due_at: string
          id: string
          kind: string
          notes: string | null
          opportunity_id: string | null
          organization_id: string
          owner_membership_id: string | null
          status: string
          title: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          due_at: string
          id?: string
          kind: string
          notes?: string | null
          opportunity_id?: string | null
          organization_id: string
          owner_membership_id?: string | null
          status?: string
          title: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          due_at?: string
          id?: string
          kind?: string
          notes?: string | null
          opportunity_id?: string | null
          organization_id?: string
          owner_membership_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_follow_ups_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "crm_follow_ups_organization_id_customer_id_opportunity_id_fkey"
            columns: ["organization_id", "customer_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "crm_follow_ups_organization_id_customer_id_opportunity_id_fkey"
            columns: ["organization_id", "customer_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_worklist"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "crm_follow_ups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_follow_ups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_follow_ups_organization_id_owner_membership_id_fkey"
            columns: ["organization_id", "owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_commercial_proposal_addons: {
        Row: {
          addon_plan_id: string
          label: string
          organization_id: string
          price_minor: number
          proposal_id: string
        }
        Insert: {
          addon_plan_id: string
          label: string
          organization_id: string
          price_minor: number
          proposal_id: string
        }
        Update: {
          addon_plan_id?: string
          label?: string
          organization_id?: string
          price_minor?: number
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_commercial_proposal_a_organization_id_proposal_id_fkey"
            columns: ["organization_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "customer_commercial_proposals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_commercial_proposal_addons_addon_plan_id_fkey"
            columns: ["addon_plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_commercial_proposal_addons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_commercial_proposal_addons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_commercial_proposals: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_configuration: Json | null
          addon_price_minor: number
          billing_interval: string
          created_at: string
          created_by: string
          currency: string
          customer_id: string
          declined_at: string | null
          declined_by: string | null
          discount_minor: number
          discount_reason: string | null
          id: string
          notes: string
          organization_id: string
          plan_id: string
          plan_label: string
          plan_price_minor: number
          proposed_configuration: Json | null
          status: string
          supersedes_id: string | null
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_configuration?: Json | null
          addon_price_minor?: number
          billing_interval: string
          created_at?: string
          created_by: string
          currency: string
          customer_id: string
          declined_at?: string | null
          declined_by?: string | null
          discount_minor?: number
          discount_reason?: string | null
          id?: string
          notes?: string
          organization_id: string
          plan_id: string
          plan_label: string
          plan_price_minor: number
          proposed_configuration?: Json | null
          status?: string
          supersedes_id?: string | null
          version: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_configuration?: Json | null
          addon_price_minor?: number
          billing_interval?: string
          created_at?: string
          created_by?: string
          currency?: string
          customer_id?: string
          declined_at?: string | null
          declined_by?: string | null
          discount_minor?: number
          discount_reason?: string | null
          id?: string
          notes?: string
          organization_id?: string
          plan_id?: string
          plan_label?: string
          plan_price_minor?: number
          proposed_configuration?: Json | null
          status?: string
          supersedes_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_commercial_proposals_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_commercial_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_commercial_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_commercial_proposals_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_commercial_proposals_supersedes_same_org"
            columns: ["organization_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "customer_commercial_proposals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_discovery_snapshots: {
        Row: {
          answers: Json
          created_at: string
          created_by: string
          customer_id: string
          id: string
          organization_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          organization_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_discovery_snapshots_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_discovery_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_discovery_snapshots_organization_id_fkey"
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
      customer_notification_recipients: {
        Row: {
          consent_at: string
          customer_id: string
          email_address: string
          established_by: string
          id: string
          organization_id: string
          portal_invite_id: string
          purposes: string[]
          verification_method: string
          verified_at: string
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          consent_at: string
          customer_id: string
          email_address: string
          established_by: string
          id?: string
          organization_id: string
          portal_invite_id: string
          purposes: string[]
          verification_method?: string
          verified_at: string
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          consent_at?: string
          customer_id?: string
          email_address?: string
          established_by?: string
          id?: string
          organization_id?: string
          portal_invite_id?: string
          purposes?: string[]
          verification_method?: string
          verified_at?: string
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_notification_recipie_organization_id_portal_invit_fkey"
            columns: ["organization_id", "portal_invite_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_invites"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_notification_recipien_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_notification_settings: {
        Row: {
          customer_id: string
          email_identity_id: string
          organization_id: string
        }
        Insert: {
          customer_id: string
          email_identity_id: string
          organization_id: string
        }
        Update: {
          customer_id?: string
          email_identity_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notification_setting_organization_id_email_identi_fkey"
            columns: ["organization_id", "email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_notification_settings_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
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
      customer_proposal_handoffs: {
        Row: {
          accepted_configuration: Json | null
          commercial_terms: Json
          created_at: string
          created_by: string
          created_organization_id: string
          customer_id: string
          discovery_snapshot: Json
          id: string
          organization_id: string
          proposal_id: string
        }
        Insert: {
          accepted_configuration?: Json | null
          commercial_terms: Json
          created_at?: string
          created_by: string
          created_organization_id: string
          customer_id: string
          discovery_snapshot: Json
          id?: string
          organization_id: string
          proposal_id: string
        }
        Update: {
          accepted_configuration?: Json | null
          commercial_terms?: Json
          created_at?: string
          created_by?: string
          created_organization_id?: string
          customer_id?: string
          discovery_snapshot?: Json
          id?: string
          organization_id?: string
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_proposal_handoffs_created_organization_id_fkey"
            columns: ["created_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_proposal_handoffs_created_organization_id_fkey"
            columns: ["created_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_proposal_handoffs_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_proposal_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_proposal_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_proposal_handoffs_organization_id_proposal_id_fkey"
            columns: ["organization_id", "proposal_id"]
            isOneToOne: true
            referencedRelation: "customer_commercial_proposals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_proposal_invites: {
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
            foreignKeyName: "customer_proposal_invites_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_proposal_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_proposal_invites_organization_id_fkey"
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
      document_links: {
        Row: {
          asset_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          document_id: string
          id: string
          location_id: string | null
          organization_id: string
          work_item_id: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          document_id: string
          id?: string
          location_id?: string | null
          organization_id: string
          work_item_id?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          document_id?: string
          id?: string
          location_id?: string | null
          organization_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_links_asset_same_org"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "document_links_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "document_links_document_same_org"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "document_links_location_same_org"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "document_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "document_links_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      documents: {
        Row: {
          agent_user_id: string | null
          content_sha256: string | null
          created_at: string
          created_by: string
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          agent_user_id?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by: string
          file_name: string
          id?: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          agent_user_id?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by?: string
          file_name?: string
          id?: string
          mime_type?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
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
        ]
      }
      email_identities: {
        Row: {
          address: string
          can_receive: boolean
          can_send: boolean
          created_at: string
          created_by: string | null
          display_name: string | null
          id: string
          integration_connection_id: string | null
          organization_id: string
          ownership: string
          sending_domain_resource_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address: string
          can_receive?: boolean
          can_send?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          integration_connection_id?: string | null
          organization_id: string
          ownership: string
          sending_domain_resource_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          can_receive?: boolean
          can_send?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          integration_connection_id?: string | null
          organization_id?: string
          ownership?: string
          sending_domain_resource_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_identities_organization_id_integration_connection_id_fkey"
            columns: ["organization_id", "integration_connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "email_identities_organization_id_sending_domain_resource_i_fkey"
            columns: ["organization_id", "sending_domain_resource_id"]
            isOneToOne: false
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      email_message_details: {
        Row: {
          authentication: Json | null
          cc_addresses: string[]
          from_address: string
          from_name: string | null
          html_body: string | null
          in_reply_to: string | null
          message_id: string
          organization_id: string
          reference_ids: string[]
          rfc_message_id: string | null
          subject: string
          to_addresses: string[]
        }
        Insert: {
          authentication?: Json | null
          cc_addresses?: string[]
          from_address: string
          from_name?: string | null
          html_body?: string | null
          in_reply_to?: string | null
          message_id: string
          organization_id: string
          reference_ids?: string[]
          rfc_message_id?: string | null
          subject?: string
          to_addresses?: string[]
        }
        Update: {
          authentication?: Json | null
          cc_addresses?: string[]
          from_address?: string
          from_name?: string | null
          html_body?: string | null
          in_reply_to?: string | null
          message_id?: string
          organization_id?: string
          reference_ids?: string[]
          rfc_message_id?: string | null
          subject?: string
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_message_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_message_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_message_details_organization_id_message_id_fkey"
            columns: ["organization_id", "message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      email_recipient_suppressions: {
        Row: {
          created_at: string
          email_address: string
          message_id: string
          organization_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          email_address: string
          message_id: string
          organization_id: string
          reason: string
        }
        Update: {
          created_at?: string
          email_address?: string
          message_id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_recipient_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipient_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipient_suppressions_organization_id_message_id_fkey"
            columns: ["organization_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      email_test_sends: {
        Row: {
          created_at: string
          detail: string | null
          email_identity_id: string
          external_id: string | null
          finished_at: string | null
          from_address: string
          from_name: string | null
          id: string
          organization_id: string
          provider_state: string | null
          provider_state_at: string | null
          recipient: string
          reply_to: string | null
          requested_by: string
          state: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          email_identity_id: string
          external_id?: string | null
          finished_at?: string | null
          from_address: string
          from_name?: string | null
          id?: string
          organization_id: string
          provider_state?: string | null
          provider_state_at?: string | null
          recipient: string
          reply_to?: string | null
          requested_by: string
          state?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          email_identity_id?: string
          external_id?: string | null
          finished_at?: string | null
          from_address?: string
          from_name?: string | null
          id?: string
          organization_id?: string
          provider_state?: string | null
          provider_state_at?: string | null
          recipient?: string
          reply_to?: string | null
          requested_by?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_test_sends_organization_id_email_identity_id_fkey"
            columns: ["organization_id", "email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "email_test_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_test_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_deliverables: {
        Row: {
          ai_deployment_id: string | null
          automation_rule_id: string | null
          created_at: string
          created_by: string
          engagement_id: string
          form_id: string | null
          id: string
          organization_id: string
          portal_id: string | null
          site_id: string | null
          tenant_organization_id: string
        }
        Insert: {
          ai_deployment_id?: string | null
          automation_rule_id?: string | null
          created_at?: string
          created_by: string
          engagement_id: string
          form_id?: string | null
          id?: string
          organization_id: string
          portal_id?: string | null
          site_id?: string | null
          tenant_organization_id: string
        }
        Update: {
          ai_deployment_id?: string | null
          automation_rule_id?: string | null
          created_at?: string
          created_by?: string
          engagement_id?: string
          form_id?: string | null
          id?: string
          organization_id?: string
          portal_id?: string | null
          site_id?: string | null
          tenant_organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_deliverables_organization_id_engagement_id_tena_fkey"
            columns: [
              "organization_id",
              "engagement_id",
              "tenant_organization_id",
            ]
            isOneToOne: false
            referencedRelation: "service_engagements"
            referencedColumns: [
              "organization_id",
              "id",
              "tenant_organization_id",
            ]
          },
          {
            foreignKeyName: "engagement_deliverables_tenant_organization_id_ai_deployme_fkey"
            columns: ["tenant_organization_id", "ai_deployment_id"]
            isOneToOne: false
            referencedRelation: "ai_assistant_deployments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "engagement_deliverables_tenant_organization_id_automation__fkey"
            columns: ["tenant_organization_id", "automation_rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "engagement_deliverables_tenant_organization_id_form_id_fkey"
            columns: ["tenant_organization_id", "form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "engagement_deliverables_tenant_organization_id_portal_id_fkey"
            columns: ["tenant_organization_id", "portal_id"]
            isOneToOne: false
            referencedRelation: "portal_definitions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "engagement_deliverables_tenant_organization_id_site_id_fkey"
            columns: ["tenant_organization_id", "site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      engagement_work_items: {
        Row: {
          created_at: string
          created_by: string
          engagement_id: string
          organization_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          engagement_id: string
          organization_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          engagement_id?: string
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_work_items_organization_id_engagement_id_fkey"
            columns: ["organization_id", "engagement_id"]
            isOneToOne: false
            referencedRelation: "service_engagements"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "engagement_work_items_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "engagement_work_items_organization_id_work_item_id_fkey"
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
          portal_expires_at: string | null
          portal_invite_id: string | null
          proposal_expires_at: string | null
          proposal_invite_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id: string
          portal_expires_at?: string | null
          portal_invite_id?: string | null
          proposal_expires_at?: string | null
          proposal_invite_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id?: string
          portal_expires_at?: string | null
          portal_invite_id?: string | null
          proposal_expires_at?: string | null
          proposal_invite_id?: string | null
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
          {
            foreignKeyName: "external_actors_portal_invite_same_org"
            columns: ["organization_id", "portal_invite_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_invites"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "external_actors_proposal_invite_same_org"
            columns: ["organization_id", "proposal_invite_id"]
            isOneToOne: false
            referencedRelation: "customer_proposal_invites"
            referencedColumns: ["organization_id", "id"]
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
      form_revisions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          definition: Json
          form_id: string
          id: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          revision_number: number
          status: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          definition: Json
          form_id: string
          id?: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          revision_number: number
          status: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          definition?: Json
          form_id?: string
          id?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          revision_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_revisions_organization_id_form_id_fkey"
            columns: ["organization_id", "form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          answers: Json
          booking_work_item_id: string | null
          context: Json
          customer_id: string | null
          form_id: string
          form_revision_id: string
          id: string
          organization_id: string
          source: string
          submitted_at: string
          submitted_by: string
        }
        Insert: {
          answers: Json
          booking_work_item_id?: string | null
          context?: Json
          customer_id?: string | null
          form_id: string
          form_revision_id: string
          id?: string
          organization_id: string
          source?: string
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          answers?: Json
          booking_work_item_id?: string | null
          context?: Json
          customer_id?: string | null
          form_id?: string
          form_revision_id?: string
          id?: string
          organization_id?: string
          source?: string
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_booking_fk"
            columns: ["organization_id", "booking_work_item_id"]
            isOneToOne: false
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "form_submissions_booking_fk"
            columns: ["organization_id", "booking_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "form_submissions_customer_fk"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "form_submissions_organization_id_form_id_form_revision_id_fkey"
            columns: ["organization_id", "form_id", "form_revision_id"]
            isOneToOne: false
            referencedRelation: "form_revisions"
            referencedColumns: ["organization_id", "form_id", "id"]
          },
        ]
      }
      form_templates: {
        Row: {
          category: string
          created_at: string
          definition: Json
          description: string
          display_order: number
          id: string
          key: string
          name: string
        }
        Insert: {
          category: string
          created_at?: string
          definition: Json
          description: string
          display_order?: number
          id?: string
          key: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string
          definition?: Json
          description?: string
          display_order?: number
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      forms: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string
          created_from_template_key: string | null
          current_published_revision_id: string | null
          id: string
          name: string
          organization_id: string
          public_key: string
          slug: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by: string
          created_from_template_key?: string | null
          current_published_revision_id?: string | null
          id?: string
          name: string
          organization_id: string
          public_key?: string
          slug: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string
          created_from_template_key?: string | null
          current_published_revision_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          public_key?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_published_revision_belongs_to_form"
            columns: ["organization_id", "id", "current_published_revision_id"]
            isOneToOne: false
            referencedRelation: "form_revisions"
            referencedColumns: ["organization_id", "form_id", "id"]
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
      integration_action_queue: {
        Row: {
          action_id: string
          arguments: Json
          attempts: number
          claimed_at: string | null
          detail: string | null
          finished_at: string | null
          grant_id: string
          id: string
          organization_id: string
          queued_at: string
          rule_id: string
          state: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          action_id: string
          arguments: Json
          attempts?: number
          claimed_at?: string | null
          detail?: string | null
          finished_at?: string | null
          grant_id: string
          id?: string
          organization_id: string
          queued_at?: string
          rule_id: string
          state?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          action_id?: string
          arguments?: Json
          attempts?: number
          claimed_at?: string | null
          detail?: string | null
          finished_at?: string | null
          grant_id?: string
          id?: string
          organization_id?: string
          queued_at?: string
          rule_id?: string
          state?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_action_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_action_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_capability_permissions: {
        Row: {
          capability_key: string
          required_permission: string
        }
        Insert: {
          capability_key: string
          required_permission: string
        }
        Update: {
          capability_key?: string
          required_permission?: string
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          account_label: string | null
          connected_by: string
          connector_key: string
          created_at: string
          id: string
          last_error: string | null
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
          last_error?: string | null
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
          last_error?: string | null
          last_verified_at?: string | null
          organization_id?: string
          scopes?: string[]
          secret_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connector_fk"
            columns: ["connector_key"]
            isOneToOne: false
            referencedRelation: "platform_connectors"
            referencedColumns: ["key"]
          },
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
      integration_executions: {
        Row: {
          approval_state: string
          approved_at: string | null
          approved_by: string | null
          arguments_hash: string | null
          capability_key: string | null
          completed_at: string | null
          connection_id: string | null
          connector_key: string | null
          conversation_id: string | null
          correlation_id: string | null
          decision: string
          delivered_at: string | null
          duration_ms: number | null
          error_class: string | null
          expires_at: string | null
          grant_id: string | null
          id: string
          invoked_by: string | null
          mcp_server_id: string | null
          mcp_tool_id: string | null
          organization_id: string
          pending_arguments: Json | null
          principal_id: string
          principal_kind: string
          refusal_reason: string | null
          requested_at: string
          resource_value: string | null
          result_bytes: number | null
          result_payload: Json | null
          started_at: string | null
          status: string
          target_kind: string | null
          tool_name: string | null
        }
        Insert: {
          approval_state?: string
          approved_at?: string | null
          approved_by?: string | null
          arguments_hash?: string | null
          capability_key?: string | null
          completed_at?: string | null
          connection_id?: string | null
          connector_key?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          decision: string
          delivered_at?: string | null
          duration_ms?: number | null
          error_class?: string | null
          expires_at?: string | null
          grant_id?: string | null
          id?: string
          invoked_by?: string | null
          mcp_server_id?: string | null
          mcp_tool_id?: string | null
          organization_id: string
          pending_arguments?: Json | null
          principal_id: string
          principal_kind: string
          refusal_reason?: string | null
          requested_at?: string
          resource_value?: string | null
          result_bytes?: number | null
          result_payload?: Json | null
          started_at?: string | null
          status: string
          target_kind?: string | null
          tool_name?: string | null
        }
        Update: {
          approval_state?: string
          approved_at?: string | null
          approved_by?: string | null
          arguments_hash?: string | null
          capability_key?: string | null
          completed_at?: string | null
          connection_id?: string | null
          connector_key?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          decision?: string
          delivered_at?: string | null
          duration_ms?: number | null
          error_class?: string | null
          expires_at?: string | null
          grant_id?: string | null
          id?: string
          invoked_by?: string | null
          mcp_server_id?: string | null
          mcp_tool_id?: string | null
          organization_id?: string
          pending_arguments?: Json | null
          principal_id?: string
          principal_kind?: string
          refusal_reason?: string | null
          requested_at?: string
          resource_value?: string | null
          result_bytes?: number | null
          result_payload?: Json | null
          started_at?: string | null
          status?: string
          target_kind?: string | null
          tool_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_library_actions: {
        Row: {
          application_key: string
          capability_key: string
          connector_key: string
          input_schema: Json
          required_permission: string
        }
        Insert: {
          application_key: string
          capability_key: string
          connector_key: string
          input_schema: Json
          required_permission: string
        }
        Update: {
          application_key?: string
          capability_key?: string
          connector_key?: string
          input_schema?: Json
          required_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_library_actions_connector_key_fkey"
            columns: ["connector_key"]
            isOneToOne: false
            referencedRelation: "platform_connectors"
            referencedColumns: ["key"]
          },
        ]
      }
      integration_library_jobs: {
        Row: {
          arguments: Json
          capability_key: string
          claimed_at: string | null
          connection_id: string
          execution_id: string
          expires_at: string
          id: string
          organization_id: string
        }
        Insert: {
          arguments: Json
          capability_key: string
          claimed_at?: string | null
          connection_id: string
          execution_id: string
          expires_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          arguments?: Json
          capability_key?: string
          claimed_at?: string | null
          connection_id?: string
          execution_id?: string
          expires_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_library_jobs_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "integration_library_actions"
            referencedColumns: ["capability_key"]
          },
          {
            foreignKeyName: "integration_library_jobs_execution_same_org"
            columns: ["organization_id", "execution_id"]
            isOneToOne: false
            referencedRelation: "integration_executions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_library_jobs_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
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
      integration_mcp_servers: {
        Row: {
          connection_id: string
          created_at: string
          created_by: string
          discovery_status: string
          enabled: boolean
          endpoint: string
          id: string
          last_discovered_at: string | null
          last_discovery_error: string | null
          name: string
          organization_id: string
          protocol_version: string | null
          server_name: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          created_by: string
          discovery_status?: string
          enabled?: boolean
          endpoint: string
          id?: string
          last_discovered_at?: string | null
          last_discovery_error?: string | null
          name: string
          organization_id: string
          protocol_version?: string | null
          server_name?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          created_by?: string
          discovery_status?: string
          enabled?: boolean
          endpoint?: string
          id?: string
          last_discovered_at?: string | null
          last_discovery_error?: string | null
          name?: string
          organization_id?: string
          protocol_version?: string | null
          server_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_mcp_servers_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: true
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_mcp_servers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_mcp_servers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_mcp_tools: {
        Row: {
          classification: string
          description: string
          enabled: boolean
          first_seen_at: string
          id: string
          input_schema: Json
          last_seen_at: string
          name: string
          organization_id: string
          read_only_hint: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          schema_hash: string
          server_id: string
          status: string
        }
        Insert: {
          classification?: string
          description?: string
          enabled?: boolean
          first_seen_at?: string
          id?: string
          input_schema?: Json
          last_seen_at?: string
          name: string
          organization_id: string
          read_only_hint?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schema_hash: string
          server_id: string
          status?: string
        }
        Update: {
          classification?: string
          description?: string
          enabled?: boolean
          first_seen_at?: string
          id?: string
          input_schema?: Json
          last_seen_at?: string
          name?: string
          organization_id?: string
          read_only_hint?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schema_hash?: string
          server_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_mcp_tools_organization_id_server_id_fkey"
            columns: ["organization_id", "server_id"]
            isOneToOne: false
            referencedRelation: "integration_mcp_servers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_resource_records: {
        Row: {
          content_hash: string
          deleted: boolean
          display_name: string
          external_id: string
          generation: number
          metadata: Json
          organization_id: string
          resource_id: string
          source_updated_at: string
        }
        Insert: {
          content_hash: string
          deleted?: boolean
          display_name: string
          external_id: string
          generation: number
          metadata: Json
          organization_id: string
          resource_id: string
          source_updated_at?: string
        }
        Update: {
          content_hash?: string
          deleted?: boolean
          display_name?: string
          external_id?: string
          generation?: number
          metadata?: Json
          organization_id?: string
          resource_id?: string
          source_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_resource_records_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_resource_syncs: {
        Row: {
          cursor: Json
          enabled: boolean
          generation: number
          last_error: string | null
          last_success_at: string | null
          lease_id: string | null
          lease_until: string | null
          next_run_at: string
          organization_id: string
          parameters: Json
          resource_id: string
          state: string
        }
        Insert: {
          cursor?: Json
          enabled?: boolean
          generation?: number
          last_error?: string | null
          last_success_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
          next_run_at?: string
          organization_id: string
          parameters?: Json
          resource_id: string
          state?: string
        }
        Update: {
          cursor?: Json
          enabled?: boolean
          generation?: number
          last_error?: string | null
          last_success_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
          next_run_at?: string
          organization_id?: string
          parameters?: Json
          resource_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_resource_syncs_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_resources: {
        Row: {
          connection_id: string | null
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
          connection_id?: string | null
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
          connection_id?: string | null
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
      integration_tool_grants: {
        Row: {
          assistant_id: string | null
          automation_rule_id: string | null
          capability_key: string | null
          connection_id: string | null
          granted_at: string
          granted_by: string
          id: string
          mcp_tool_id: string | null
          organization_id: string
          requires_approval: boolean
          resource_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          target_kind: string
        }
        Insert: {
          assistant_id?: string | null
          automation_rule_id?: string | null
          capability_key?: string | null
          connection_id?: string | null
          granted_at?: string
          granted_by: string
          id?: string
          mcp_tool_id?: string | null
          organization_id: string
          requires_approval?: boolean
          resource_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          target_kind: string
        }
        Update: {
          assistant_id?: string | null
          automation_rule_id?: string | null
          capability_key?: string | null
          connection_id?: string | null
          granted_at?: string
          granted_by?: string
          id?: string
          mcp_tool_id?: string | null
          organization_id?: string
          requires_approval?: boolean
          resource_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_tool_grants_organization_id_assistant_id_fkey"
            columns: ["organization_id", "assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_automation_rule_id_fkey"
            columns: ["organization_id", "automation_rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_mcp_tool_id_fkey"
            columns: ["organization_id", "mcp_tool_id"]
            isOneToOne: false
            referencedRelation: "integration_mcp_tools"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "integration_tool_grants_organization_id_resource_id_fkey"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "integration_resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invitation_deliveries: {
        Row: {
          detail: string | null
          id: string
          invitation_id: string
          occurred_at: string
          organization_id: string
          payload: Json
          payload_hash: string
          provider_event_at: string | null
          provider_message_id: string | null
          recipient: string
          source: string
          state: string
        }
        Insert: {
          detail?: string | null
          id?: string
          invitation_id: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          payload_hash: string
          provider_event_at?: string | null
          provider_message_id?: string | null
          recipient: string
          source: string
          state: string
        }
        Update: {
          detail?: string | null
          id?: string
          invitation_id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          payload_hash?: string
          provider_event_at?: string | null
          provider_message_id?: string | null
          recipient?: string
          source?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_deliveries_invitation_same_org"
            columns: ["organization_id", "invitation_id"]
            isOneToOne: false
            referencedRelation: "organization_invitations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invitation_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_deliveries_organization_id_fkey"
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
            referencedRelation: "finance_invoice_records"
            referencedColumns: ["organization_id", "id"]
          },
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
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
      marketing_audiences: {
        Row: {
          created_at: string
          created_before: string | null
          created_by: string
          created_from: string | null
          definition_version: number
          description: string
          id: string
          name: string
          organization_id: string
          stage_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_before?: string | null
          created_by: string
          created_from?: string | null
          definition_version?: number
          description?: string
          id?: string
          name: string
          organization_id: string
          stage_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_before?: string | null
          created_by?: string
          created_from?: string | null
          definition_version?: number
          description?: string
          id?: string
          name?: string
          organization_id?: string
          stage_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_audiences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_audiences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_audiences_organization_id_stage_id_fkey"
            columns: ["organization_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "customer_stages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      marketing_campaign_audiences: {
        Row: {
          audience_id: string
          campaign_id: string
          organization_id: string
        }
        Insert: {
          audience_id: string
          campaign_id: string
          organization_id: string
        }
        Update: {
          audience_id?: string
          campaign_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_audiences_organization_id_audience_id_fkey"
            columns: ["organization_id", "audience_id"]
            isOneToOne: false
            referencedRelation: "marketing_audiences"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_campaign_audiences_organization_id_campaign_id_fkey"
            columns: ["organization_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      marketing_campaign_forms: {
        Row: {
          campaign_id: string
          created_at: string
          form_id: string
          organization_id: string
          token: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          form_id: string
          organization_id: string
          token?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          form_id?: string
          organization_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaign_forms_organization_id_campaign_id_fkey"
            columns: ["organization_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_campaign_forms_organization_id_form_id_fkey"
            columns: ["organization_id", "form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          archived_at: string | null
          channels: string[]
          created_at: string
          created_by: string
          description: string
          id: string
          landing_page_id: string | null
          landing_revision_id: string | null
          landing_site_id: string | null
          name: string
          objective: string
          organization_id: string
          owner_membership_id: string | null
          planned_end_on: string | null
          planned_start_on: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          channels?: string[]
          created_at?: string
          created_by: string
          description?: string
          id?: string
          landing_page_id?: string | null
          landing_revision_id?: string | null
          landing_site_id?: string | null
          name: string
          objective: string
          organization_id: string
          owner_membership_id?: string | null
          planned_end_on?: string | null
          planned_start_on?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          channels?: string[]
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          landing_page_id?: string | null
          landing_revision_id?: string | null
          landing_site_id?: string | null
          name?: string
          objective?: string
          organization_id?: string
          owner_membership_id?: string | null
          planned_end_on?: string | null
          planned_start_on?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_organization_id_landing_site_id_landin_fkey"
            columns: [
              "organization_id",
              "landing_site_id",
              "landing_revision_id",
            ]
            isOneToOne: false
            referencedRelation: "public_site_revisions"
            referencedColumns: ["organization_id", "site_id", "id"]
          },
          {
            foreignKeyName: "marketing_campaigns_organization_id_owner_membership_id_fkey"
            columns: ["organization_id", "owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      marketing_inquiries: {
        Row: {
          campaign_id: string | null
          campaign_name_at_capture: string | null
          created_at: string
          customer_id: string | null
          form_id: string
          form_name_at_capture: string
          handed_off_at: string | null
          id: string
          occurred_at: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_context: Json
          status: string
          submission_id: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_name_at_capture?: string | null
          created_at?: string
          customer_id?: string | null
          form_id: string
          form_name_at_capture: string
          handed_off_at?: string | null
          id?: string
          occurred_at: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          source_context?: Json
          status?: string
          submission_id: string
        }
        Update: {
          campaign_id?: string | null
          campaign_name_at_capture?: string | null
          created_at?: string
          customer_id?: string | null
          form_id?: string
          form_name_at_capture?: string
          handed_off_at?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_context?: Json
          status?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_inquiries_organization_id_campaign_id_fkey"
            columns: ["organization_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_inquiries_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_inquiries_organization_id_form_id_fkey"
            columns: ["organization_id", "form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_inquiries_organization_id_form_id_submission_id_fkey"
            columns: ["organization_id", "form_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["organization_id", "form_id", "id"]
          },
        ]
      }
      marketing_submission_requests: {
        Row: {
          fingerprint: string
          form_id: string
          organization_id: string
          request_id: string
          submission_id: string
        }
        Insert: {
          fingerprint: string
          form_id: string
          organization_id: string
          request_id: string
          submission_id: string
        }
        Update: {
          fingerprint?: string
          form_id?: string
          organization_id?: string
          request_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_submission_requests_organization_id_form_id_fkey"
            columns: ["organization_id", "form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "marketing_submission_requests_organization_id_form_id_subm_fkey"
            columns: ["organization_id", "form_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["organization_id", "form_id", "id"]
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
          display_name?: string
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
      message_attachments: {
        Row: {
          content_disposition: string | null
          content_id: string | null
          content_type: string
          created_at: string
          filename: string
          id: string
          message_id: string
          organization_id: string
          provider_attachment_id: string | null
          rejection_reason: string | null
          size_bytes: number | null
          storage_path: string | null
          storage_state: string
        }
        Insert: {
          content_disposition?: string | null
          content_id?: string | null
          content_type: string
          created_at?: string
          filename: string
          id?: string
          message_id: string
          organization_id: string
          provider_attachment_id?: string | null
          rejection_reason?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          storage_state?: string
        }
        Update: {
          content_disposition?: string | null
          content_id?: string | null
          content_type?: string
          created_at?: string
          filename?: string
          id?: string
          message_id?: string
          organization_id?: string
          provider_attachment_id?: string | null
          rejection_reason?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          storage_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_organization_id_message_id_fkey"
            columns: ["organization_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      message_deliveries: {
        Row: {
          attempts: number
          body: string
          channel: string
          claimed_at: string | null
          detail: string | null
          email_identity_id: string | null
          external_id: string | null
          first_attempt_at: string | null
          from_address: string | null
          from_name: string | null
          id: string
          organization_id: string
          provider_detail: string | null
          provider_state: string | null
          provider_state_at: string | null
          queued_at: string
          recipient: string
          reply_to: string | null
          rule_id: string
          rule_name: string
          sent_at: string | null
          state: string
          subject_id: string
          subject_line: string
          subject_type: string
        }
        Insert: {
          attempts?: number
          body: string
          channel: string
          claimed_at?: string | null
          detail?: string | null
          email_identity_id?: string | null
          external_id?: string | null
          first_attempt_at?: string | null
          from_address?: string | null
          from_name?: string | null
          id?: string
          organization_id: string
          provider_detail?: string | null
          provider_state?: string | null
          provider_state_at?: string | null
          queued_at?: string
          recipient: string
          reply_to?: string | null
          rule_id: string
          rule_name: string
          sent_at?: string | null
          state?: string
          subject_id: string
          subject_line?: string
          subject_type: string
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          claimed_at?: string | null
          detail?: string | null
          email_identity_id?: string | null
          external_id?: string | null
          first_attempt_at?: string | null
          from_address?: string | null
          from_name?: string | null
          id?: string
          organization_id?: string
          provider_detail?: string | null
          provider_state?: string | null
          provider_state_at?: string | null
          queued_at?: string
          recipient?: string
          reply_to?: string | null
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
            foreignKeyName: "message_deliveries_email_identity_fk"
            columns: ["organization_id", "email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
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
      message_events: {
        Row: {
          detail: string | null
          event_type: string
          id: string
          message_id: string
          occurred_at: string
          organization_id: string
          payload: Json
          provider_event_at: string | null
          provider_event_id: string | null
          status_after: string | null
        }
        Insert: {
          detail?: string | null
          event_type: string
          id?: string
          message_id: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          provider_event_at?: string | null
          provider_event_id?: string | null
          status_after?: string | null
        }
        Update: {
          detail?: string | null
          event_type?: string
          id?: string
          message_id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          provider_event_at?: string | null
          provider_event_id?: string | null
          status_after?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_events_organization_id_message_id_fkey"
            columns: ["organization_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["organization_id", "id"]
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
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          direction: string
          external_id: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          intent: string
          organization_id: string
          requested_transport: string
          segment_count: number | null
          sent_at: string | null
          status: string
          transport: string | null
        }
        Insert: {
          body?: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction: string
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          intent?: string
          organization_id: string
          requested_transport?: string
          segment_count?: number | null
          sent_at?: string | null
          status?: string
          transport?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: string
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          intent?: string
          organization_id?: string
          requested_transport?: string
          segment_count?: number | null
          sent_at?: string | null
          status?: string
          transport?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_opt_outs: {
        Row: {
          external_number: string
          occurred_at: string
          opted_out: boolean
          organization_id: string
          source: string
        }
        Insert: {
          external_number: string
          occurred_at?: string
          opted_out?: boolean
          organization_id: string
          source: string
        }
        Update: {
          external_number?: string
          occurred_at?: string
          opted_out?: boolean
          organization_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_opt_outs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_opt_outs_organization_id_fkey"
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
      opportunities: {
        Row: {
          amount_minor: number | null
          created_at: string
          created_by: string
          currency: string | null
          customer_id: string
          expected_close_on: string | null
          id: string
          organization_id: string
          owner_membership_id: string | null
          stage_id: string | null
          title: string
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          created_by: string
          currency?: string | null
          customer_id: string
          expected_close_on?: string | null
          id?: string
          organization_id: string
          owner_membership_id?: string | null
          stage_id?: string | null
          title: string
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          created_by?: string
          currency?: string | null
          customer_id?: string
          expected_close_on?: string | null
          id?: string
          organization_id?: string
          owner_membership_id?: string | null
          stage_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_same_org"
            columns: ["organization_id", "owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "opportunities_stage_same_org"
            columns: ["organization_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "opportunity_stages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      opportunity_stages: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          name: string
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: string
          name: string
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_business_profiles: {
        Row: {
          labels: Json
          navigation: Json
          nouns: Json
          organization_id: string
          revision: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          labels?: Json
          navigation?: Json
          nouns?: Json
          organization_id: string
          revision: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          labels?: Json
          navigation?: Json
          nouns?: Json
          organization_id?: string
          revision?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_business_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_business_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_charge_components: {
        Row: {
          amount_minor: number
          billing_period_end: string
          billing_period_start: string
          component_type: string
          computed_at: string
          computed_by: string | null
          currency: string
          description: string
          finalized_at: string | null
          id: string
          organization_id: string
          provenance: Json
          source_domain: string
          source_record_id: string
        }
        Insert: {
          amount_minor: number
          billing_period_end: string
          billing_period_start: string
          component_type: string
          computed_at?: string
          computed_by?: string | null
          currency: string
          description: string
          finalized_at?: string | null
          id?: string
          organization_id: string
          provenance?: Json
          source_domain: string
          source_record_id: string
        }
        Update: {
          amount_minor?: number
          billing_period_end?: string
          billing_period_start?: string
          component_type?: string
          computed_at?: string
          computed_by?: string | null
          currency?: string
          description?: string
          finalized_at?: string | null
          id?: string
          organization_id?: string
          provenance?: Json
          source_domain?: string
          source_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_charge_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_charge_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_commercial_adjustments: {
        Row: {
          amount_minor: number
          currency: string
          direction: string
          effective_at: string
          id: string
          organization_id: string
          reason: string
          recorded_at: string
          recorded_by: string | null
        }
        Insert: {
          amount_minor: number
          currency: string
          direction: string
          effective_at: string
          id?: string
          organization_id: string
          reason: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Update: {
          amount_minor?: number
          currency?: string
          direction?: string
          effective_at?: string
          id?: string
          organization_id?: string
          reason?: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_commercial_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_commercial_adjustments_organization_id_fkey"
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
      organization_credits: {
        Row: {
          amount_minor: number
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
            foreignKeyName: "organization_credits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_credits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_domains: {
        Row: {
          configuration_state: string
          created_at: string
          created_by: string
          error_code: string | null
          error_message: string | null
          hostname: string
          id: string
          is_primary: boolean
          last_checked_at: string | null
          organization_id: string
          provider_key: string
          provider_resource_id: string | null
          released_at: string | null
          released_by: string | null
          ssl_state: string
          surface: string
          updated_at: string
          verification_state: string
        }
        Insert: {
          configuration_state?: string
          created_at?: string
          created_by: string
          error_code?: string | null
          error_message?: string | null
          hostname: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          organization_id: string
          provider_key?: string
          provider_resource_id?: string | null
          released_at?: string | null
          released_by?: string | null
          ssl_state?: string
          surface: string
          updated_at?: string
          verification_state?: string
        }
        Update: {
          configuration_state?: string
          created_at?: string
          created_by?: string
          error_code?: string | null
          error_message?: string | null
          hostname?: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          organization_id?: string
          provider_key?: string
          provider_resource_id?: string | null
          released_at?: string | null
          released_by?: string | null
          ssl_state?: string
          surface?: string
          updated_at?: string
          verification_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_domains_organization_id_provider_resource_id_fkey"
            columns: ["organization_id", "provider_resource_id"]
            isOneToOne: false
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_domains_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      organization_email_sending: {
        Row: {
          default_email_identity_id: string
          organization_id: string
          reply_to_email_identity_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_email_identity_id: string
          organization_id: string
          reply_to_email_identity_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_email_identity_id?: string
          organization_id?: string
          reply_to_email_identity_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_email_sending_organization_id_default_email_i_fkey"
            columns: ["organization_id", "default_email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_email_sending_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_email_sending_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_email_sending_reply_to_fk"
            columns: ["organization_id", "reply_to_email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
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
      organization_identity: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country_code: string | null
          industry: string | null
          legal_name: string | null
          organization_id: string
          postal_code: string | null
          region: string | null
          updated_at: string
          updated_by: string
          website_url: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country_code?: string | null
          industry?: string | null
          legal_name?: string | null
          organization_id: string
          postal_code?: string | null
          region?: string | null
          updated_at?: string
          updated_by: string
          website_url?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country_code?: string | null
          industry?: string | null
          legal_name?: string | null
          organization_id?: string
          postal_code?: string | null
          region?: string | null
          updated_at?: string
          updated_by?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_identity_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_identity_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
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
      organization_plan_agreement_provider_prices: {
        Row: {
          agreement_id: string
          billing_interval: string
          environment: string
          id: string
          organization_id: string
          price_reference: string
          product_reference: string
          provisioned_at: string
          provisioned_by: string | null
        }
        Insert: {
          agreement_id: string
          billing_interval: string
          environment: string
          id?: string
          organization_id: string
          price_reference: string
          product_reference: string
          provisioned_at?: string
          provisioned_by?: string | null
        }
        Update: {
          agreement_id?: string
          billing_interval?: string
          environment?: string
          id?: string
          organization_id?: string
          price_reference?: string
          product_reference?: string
          provisioned_at?: string
          provisioned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_plan_agreement_provider_price_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_agreement_provider_price_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plan_agreement_provider_prices_agreement_fk"
            columns: ["organization_id", "agreement_id"]
            isOneToOne: false
            referencedRelation: "organization_plan_agreements"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_plan_agreements: {
        Row: {
          amount_minor: number
          currency: string
          effective_from: string
          effective_to: string | null
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
          effective_to?: string | null
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
          effective_to?: string | null
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
      organization_platform_subscription_items: {
        Row: {
          active: boolean
          canonical_source_domain: string | null
          canonical_source_record_id: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          first_observed_at: string
          id: string
          last_observed_at: string
          last_provider_event_created_at: string
          last_provider_event_reference: string
          organization_id: string
          plan_id: string | null
          provider: string
          provider_item_reference: string
          provider_price_reference: string
          quantity: number | null
          removed_at: string | null
          subscription_reference: string
        }
        Insert: {
          active?: boolean
          canonical_source_domain?: string | null
          canonical_source_record_id?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment: string
          first_observed_at?: string
          id?: string
          last_observed_at?: string
          last_provider_event_created_at: string
          last_provider_event_reference: string
          organization_id: string
          plan_id?: string | null
          provider?: string
          provider_item_reference: string
          provider_price_reference: string
          quantity?: number | null
          removed_at?: string | null
          subscription_reference: string
        }
        Update: {
          active?: boolean
          canonical_source_domain?: string | null
          canonical_source_record_id?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          first_observed_at?: string
          id?: string
          last_observed_at?: string
          last_provider_event_created_at?: string
          last_provider_event_reference?: string
          organization_id?: string
          plan_id?: string | null
          provider?: string
          provider_item_reference?: string
          provider_price_reference?: string
          quantity?: number | null
          removed_at?: string | null
          subscription_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_platform_subscription_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_platform_subscription_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_platform_subscription_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_platform_subscriptions: {
        Row: {
          base_item_reference: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          checkout_session_id: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          last_provider_event_created_at: string | null
          last_provider_event_reference: string | null
          organization_id: string
          plan_id: string | null
          price_reference: string
          provider: string
          reconciled_at: string | null
          reconciliation_detail: Json
          reconciliation_state: string
          status: string
          subscription_reference: string
          updated_at: string
        }
        Insert: {
          base_item_reference?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          checkout_session_id?: string | null
          created_at?: string
          currency: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment: string
          id?: string
          last_provider_event_created_at?: string | null
          last_provider_event_reference?: string | null
          organization_id: string
          plan_id?: string | null
          price_reference: string
          provider?: string
          reconciled_at?: string | null
          reconciliation_detail?: Json
          reconciliation_state?: string
          status: string
          subscription_reference: string
          updated_at?: string
        }
        Update: {
          base_item_reference?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          checkout_session_id?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          last_provider_event_created_at?: string | null
          last_provider_event_reference?: string | null
          organization_id?: string
          plan_id?: string | null
          price_reference?: string
          provider?: string
          reconciled_at?: string | null
          reconciliation_detail?: Json
          reconciliation_state?: string
          status?: string
          subscription_reference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_platform_subscriptions_checkout_fk"
            columns: ["organization_id", "checkout_session_id"]
            isOneToOne: false
            referencedRelation: "platform_billing_checkout_sessions"
            referencedColumns: ["organization_id", "id"]
          },
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
          last_reconciled_at: string | null
          last_verified_at: string | null
          metadata: Json
          organization_id: string
          provider_account_id: string | null
          provider_key: string
          reconciliation_detail: string | null
          reconciliation_state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_reconciled_at?: string | null
          last_verified_at?: string | null
          metadata?: Json
          organization_id: string
          provider_account_id?: string | null
          provider_key: string
          reconciliation_detail?: string | null
          reconciliation_state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_reconciled_at?: string | null
          last_verified_at?: string | null
          metadata?: Json
          organization_id?: string
          provider_account_id?: string | null
          provider_key?: string
          reconciliation_detail?: string | null
          reconciliation_state?: string | null
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
            foreignKeyName: "organization_provider_bindings_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
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
            referencedRelation: "finance_invoice_records"
            referencedColumns: ["organization_id", "id"]
          },
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
            referencedRelation: "finance_invoice_records"
            referencedColumns: ["organization_id", "id"]
          },
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
            referencedRelation: "phone_number_readiness"
            referencedColumns: ["organization_id", "phone_number_id"]
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
          id: string
          label: string | null
          lifecycle: string
          organization_id: string
          origin: string
          provider_resource_id: string | null
          purpose: string
          sms_inbound_enabled: boolean
          sms_outbound_enabled: boolean
          updated_at: string
          voice_inbound_enabled: boolean
          voice_outbound_enabled: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          e164: string
          id?: string
          label?: string | null
          lifecycle?: string
          organization_id: string
          origin?: string
          provider_resource_id?: string | null
          purpose?: string
          sms_inbound_enabled?: boolean
          sms_outbound_enabled?: boolean
          updated_at?: string
          voice_inbound_enabled?: boolean
          voice_outbound_enabled?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          e164?: string
          id?: string
          label?: string | null
          lifecycle?: string
          organization_id?: string
          origin?: string
          provider_resource_id?: string | null
          purpose?: string
          sms_inbound_enabled?: boolean
          sms_outbound_enabled?: boolean
          updated_at?: string
          voice_inbound_enabled?: boolean
          voice_outbound_enabled?: boolean
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
      platform_ai_runtime_assignments: {
        Row: {
          capability: string
          model: string
          provider_account_id: string
          provider_service_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capability: string
          model: string
          provider_account_id: string
          provider_service_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capability?: string
          model?: string
          provider_account_id?: string
          provider_service_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_ai_runtime_assignments_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_ai_runtime_assignments_provider_service_id_fkey"
            columns: ["provider_service_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_services"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_allowance_counters: {
        Row: {
          allowance_key: string
          counter_argument: string | null
          counter_key: string
          created_at: string
          label: string
          note: string
        }
        Insert: {
          allowance_key: string
          counter_argument?: string | null
          counter_key: string
          created_at?: string
          label: string
          note?: string
        }
        Update: {
          allowance_key?: string
          counter_argument?: string | null
          counter_key?: string
          created_at?: string
          label?: string
          note?: string
        }
        Relationships: []
      }
      platform_billing_checkout_sessions: {
        Row: {
          environment: string
          expires_at: string | null
          id: string
          organization_id: string
          plan_price_id: string | null
          provider_confirmed_at: string | null
          provider_confirmed_event_reference: string | null
          provider_reference: string | null
          provider_subscription_reference: string | null
          quote_snapshot: Json | null
          quote_version: string | null
          reconciliation_detail: Json | null
          reconciliation_state: string | null
          requested_at: string
          requested_by: string
        }
        Insert: {
          environment: string
          expires_at?: string | null
          id?: string
          organization_id: string
          plan_price_id?: string | null
          provider_confirmed_at?: string | null
          provider_confirmed_event_reference?: string | null
          provider_reference?: string | null
          provider_subscription_reference?: string | null
          quote_snapshot?: Json | null
          quote_version?: string | null
          reconciliation_detail?: Json | null
          reconciliation_state?: string | null
          requested_at?: string
          requested_by: string
        }
        Update: {
          environment?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          plan_price_id?: string | null
          provider_confirmed_at?: string | null
          provider_confirmed_event_reference?: string | null
          provider_reference?: string | null
          provider_subscription_reference?: string | null
          quote_snapshot?: Json | null
          quote_version?: string | null
          reconciliation_detail?: Json | null
          reconciliation_state?: string | null
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
          application: string | null
          environment: string
          event_reference: string
          event_type: string
          id: string
          organization_id: string | null
          provider: string
          provider_event_created_at: string | null
          received_at: string
          reconciliation_state: string | null
        }
        Insert: {
          application?: string | null
          environment: string
          event_reference: string
          event_type: string
          id?: string
          organization_id?: string | null
          provider?: string
          provider_event_created_at?: string | null
          received_at?: string
          reconciliation_state?: string | null
        }
        Update: {
          application?: string | null
          environment?: string
          event_reference?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          provider?: string
          provider_event_created_at?: string | null
          received_at?: string
          reconciliation_state?: string | null
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
          kind: string
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
          kind?: string
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
          kind?: string
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
      platform_connector_app_features: {
        Row: {
          connector_app_id: string
          created_at: string
          feature_id: string
          note: string
          relationship: string
        }
        Insert: {
          connector_app_id: string
          created_at?: string
          feature_id: string
          note?: string
          relationship?: string
        }
        Update: {
          connector_app_id?: string
          created_at?: string
          feature_id?: string
          note?: string
          relationship?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_connector_app_features_connector_app_id_fkey"
            columns: ["connector_app_id"]
            isOneToOne: false
            referencedRelation: "platform_connector_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_connector_app_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_connector_apps: {
        Row: {
          connector_id: string
          description: string
          display_order: number
          docs_url: string | null
          id: string
          implementation_state: string
          key: string
          name: string
          vendor_status: string | null
        }
        Insert: {
          connector_id: string
          description?: string
          display_order?: number
          docs_url?: string | null
          id?: string
          implementation_state?: string
          key: string
          name: string
          vendor_status?: string | null
        }
        Update: {
          connector_id?: string
          description?: string
          display_order?: number
          docs_url?: string | null
          id?: string
          implementation_state?: string
          key?: string
          name?: string
          vendor_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_connector_apps_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "platform_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_connectors: {
        Row: {
          auth_method: string
          capabilities: string[]
          category: string
          connection_method: string
          created_at: string
          description: string
          display_order: number
          icon_ref: string | null
          id: string
          is_public: boolean
          key: string
          marketing_description: string
          marketing_slug: string | null
          marketing_summary: string
          name: string
          status: string
          suite: string | null
          updated_at: string
        }
        Insert: {
          auth_method: string
          capabilities?: string[]
          category: string
          connection_method: string
          created_at?: string
          description?: string
          display_order?: number
          icon_ref?: string | null
          id?: string
          is_public?: boolean
          key: string
          marketing_description?: string
          marketing_slug?: string | null
          marketing_summary?: string
          name: string
          status?: string
          suite?: string | null
          updated_at?: string
        }
        Update: {
          auth_method?: string
          capabilities?: string[]
          category?: string
          connection_method?: string
          created_at?: string
          description?: string
          display_order?: number
          icon_ref?: string | null
          id?: string
          is_public?: boolean
          key?: string
          marketing_description?: string
          marketing_slug?: string | null
          marketing_summary?: string
          name?: string
          status?: string
          suite?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_fx_rates: {
        Row: {
          base_currency: string
          effective_from: string
          effective_to: string | null
          id: string
          imported_at: string
          quote_currency: string
          rate: number
          recorded_by: string | null
          source: string
        }
        Insert: {
          base_currency: string
          effective_from: string
          effective_to?: string | null
          id?: string
          imported_at?: string
          quote_currency: string
          rate: number
          recorded_by?: string | null
          source: string
        }
        Update: {
          base_currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          imported_at?: string
          quote_currency?: string
          rate?: number
          recorded_by?: string | null
          source?: string
        }
        Relationships: []
      }
      platform_infrastructure_cost_components: {
        Row: {
          allocation_quality: string
          billing_period: string
          cost_category: string
          driver_basis: string | null
          driver_quantity: number | null
          fx_rate: number | null
          fx_rate_id: string | null
          id: string
          native_cost_micros: number
          native_currency: string
          note: string
          organization_id: string | null
          provider_account_id: string | null
          provider_binding_id: string | null
          provider_key: string | null
          provider_reference: string | null
          provider_resource_id: string | null
          recorded_at: string
          recorded_by: string | null
          reporting_cost_micros: number | null
          reporting_currency: string | null
          source: string
        }
        Insert: {
          allocation_quality: string
          billing_period: string
          cost_category: string
          driver_basis?: string | null
          driver_quantity?: number | null
          fx_rate?: number | null
          fx_rate_id?: string | null
          id?: string
          native_cost_micros: number
          native_currency: string
          note?: string
          organization_id?: string | null
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_key?: string | null
          provider_reference?: string | null
          provider_resource_id?: string | null
          recorded_at?: string
          recorded_by?: string | null
          reporting_cost_micros?: number | null
          reporting_currency?: string | null
          source: string
        }
        Update: {
          allocation_quality?: string
          billing_period?: string
          cost_category?: string
          driver_basis?: string | null
          driver_quantity?: number | null
          fx_rate?: number | null
          fx_rate_id?: string | null
          id?: string
          native_cost_micros?: number
          native_currency?: string
          note?: string
          organization_id?: string | null
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_key?: string | null
          provider_reference?: string | null
          provider_resource_id?: string | null
          recorded_at?: string
          recorded_by?: string | null
          reporting_cost_micros?: number | null
          reporting_currency?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_infrastructure_cost__organization_id_provider_bin_fkey"
            columns: ["organization_id", "provider_binding_id", "provider_key"]
            isOneToOne: false
            referencedRelation: "organization_provider_bindings"
            referencedColumns: ["organization_id", "id", "provider_key"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_component_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_components_fx_rate_id_fkey"
            columns: ["fx_rate_id"]
            isOneToOne: false
            referencedRelation: "platform_fx_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_components_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "platform_infrastructure_cost_organization_id_provider_bin_fkey1"
            columns: [
              "organization_id",
              "provider_binding_id",
              "provider_resource_id",
            ]
            isOneToOne: false
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "binding_id", "id"]
          },
        ]
      }
      platform_meter_cost_model_components: {
        Row: {
          component_key: string
          cost_meter_key: string
          direction: string | null
          id: string
          meter_id: string
          note: string
          provider_key: string
          quantity_multiplier: number
          region: string | null
          required: boolean
          resource_type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          component_key: string
          cost_meter_key: string
          direction?: string | null
          id?: string
          meter_id: string
          note?: string
          provider_key: string
          quantity_multiplier: number
          region?: string | null
          required?: boolean
          resource_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          component_key?: string
          cost_meter_key?: string
          direction?: string | null
          id?: string
          meter_id?: string
          note?: string
          provider_key?: string
          quantity_multiplier?: number
          region?: string | null
          required?: boolean
          resource_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_meter_cost_model_components_cost_meter_key_fkey"
            columns: ["cost_meter_key"]
            isOneToOne: false
            referencedRelation: "platform_provider_cost_meters"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "platform_meter_cost_model_components_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_meter_cost_model_components_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      platform_meters: {
        Row: {
          aggregation: string
          created_at: string
          description: string
          id: string
          label: string
          unit: string
          writer: string | null
        }
        Insert: {
          aggregation?: string
          created_at?: string
          description: string
          id: string
          label: string
          unit: string
          writer?: string | null
        }
        Update: {
          aggregation?: string
          created_at?: string
          description?: string
          id?: string
          label?: string
          unit?: string
          writer?: string | null
        }
        Relationships: []
      }
      platform_plan_addons: {
        Row: {
          addon_plan_id: string
          created_at: string
          created_by: string | null
          included_by_default: boolean
          plan_id: string
        }
        Insert: {
          addon_plan_id: string
          created_at?: string
          created_by?: string | null
          included_by_default?: boolean
          plan_id: string
        }
        Update: {
          addon_plan_id?: string
          created_at?: string
          created_by?: string | null
          included_by_default?: boolean
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_addons_addon_plan_id_fkey"
            columns: ["addon_plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_plan_addons_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_cost_assumptions: {
        Row: {
          captured_at: string
          currency: string
          id: string
          labour_cost_minor: number
          note: string
          plan_id: string
          provider_cost_minor: number
          source: string
          source_url: string | null
        }
        Insert: {
          captured_at?: string
          currency: string
          id?: string
          labour_cost_minor: number
          note?: string
          plan_id: string
          provider_cost_minor: number
          source?: string
          source_url?: string | null
        }
        Update: {
          captured_at?: string
          currency?: string
          id?: string
          labour_cost_minor?: number
          note?: string
          plan_id?: string
          provider_cost_minor?: number
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_cost_assumptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
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
      platform_plan_margin_policies: {
        Row: {
          currency: string
          effective_from: string
          hard_floor_margin: number
          id: string
          note: string
          plan_id: string
          recorded_at: string
          recorded_by: string | null
          source: string
          target_margin: number
          warning_margin: number
        }
        Insert: {
          currency: string
          effective_from?: string
          hard_floor_margin: number
          id?: string
          note?: string
          plan_id: string
          recorded_at?: string
          recorded_by?: string | null
          source: string
          target_margin: number
          warning_margin: number
        }
        Update: {
          currency?: string
          effective_from?: string
          hard_floor_margin?: number
          id?: string
          note?: string
          plan_id?: string
          recorded_at?: string
          recorded_by?: string | null
          source?: string
          target_margin?: number
          warning_margin?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_margin_policies_plan_id_fkey"
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
          effective_to: string | null
          id: string
          note: string
          plan_id: string
          recorded_by: string | null
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
          effective_to?: string | null
          id?: string
          note?: string
          plan_id: string
          recorded_by?: string | null
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
          effective_to?: string | null
          id?: string
          note?: string
          plan_id?: string
          recorded_by?: string | null
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
          allowance_type: string
          created_at: string
          display_order: number
          hard_limit: number | null
          id: string
          included_quantity: number
          label: string
          meter_id: string | null
          overage_behavior: string
          overage_policy: string
          period: string
          plan_id: string
          reset_semantics: string
          service_class: string | null
          unit: string
        }
        Insert: {
          allowance_key: string
          allowance_type?: string
          created_at?: string
          display_order?: number
          hard_limit?: number | null
          id?: string
          included_quantity: number
          label: string
          meter_id?: string | null
          overage_behavior?: string
          overage_policy?: string
          period?: string
          plan_id: string
          reset_semantics?: string
          service_class?: string | null
          unit: string
        }
        Update: {
          allowance_key?: string
          allowance_type?: string
          created_at?: string
          display_order?: number
          hard_limit?: number | null
          id?: string
          included_quantity?: number
          label?: string
          meter_id?: string | null
          overage_behavior?: string
          overage_policy?: string
          period?: string
          plan_id?: string
          reset_semantics?: string
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
      platform_plan_utilization_assumptions: {
        Row: {
          allowance_key: string
          effective_from: string
          id: string
          note: string
          plan_id: string
          recorded_at: string
          recorded_by: string | null
          scenario: string
          source: string
          utilization: number
        }
        Insert: {
          allowance_key: string
          effective_from?: string
          id?: string
          note?: string
          plan_id: string
          recorded_at?: string
          recorded_by?: string | null
          scenario: string
          source: string
          utilization: number
        }
        Update: {
          allowance_key?: string
          effective_from?: string
          id?: string
          note?: string
          plan_id?: string
          recorded_at?: string
          recorded_by?: string | null
          scenario?: string
          source?: string
          utilization?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_plan_utilization_assumptions_plan_id_fkey"
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
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
      platform_provider_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          credential_identifier: string | null
          credential_kind: string
          credential_set_at: string | null
          external_account_id: string | null
          id: string
          is_default: boolean
          label: string
          last_verified_at: string | null
          metadata: Json
          provider_key: string
          secret_id: string | null
          status: string
          updated_at: string
          verification_error: string | null
          verification_state: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credential_identifier?: string | null
          credential_kind: string
          credential_set_at?: string | null
          external_account_id?: string | null
          id?: string
          is_default?: boolean
          label: string
          last_verified_at?: string | null
          metadata?: Json
          provider_key: string
          secret_id?: string | null
          status?: string
          updated_at?: string
          verification_error?: string | null
          verification_state?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credential_identifier?: string | null
          credential_kind?: string
          credential_set_at?: string | null
          external_account_id?: string | null
          id?: string
          is_default?: boolean
          label?: string
          last_verified_at?: string | null
          metadata?: Json
          provider_key?: string
          secret_id?: string | null
          status?: string
          updated_at?: string
          verification_error?: string | null
          verification_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_accounts_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
        ]
      }
      platform_provider_cost_meters: {
        Row: {
          created_at: string
          key: string
          label: string
          service: string
          unit: string
        }
        Insert: {
          created_at?: string
          key: string
          label: string
          service: string
          unit: string
        }
        Update: {
          created_at?: string
          key?: string
          label?: string
          service?: string
          unit?: string
        }
        Relationships: []
      }
      platform_provider_rates: {
        Row: {
          approval_state: string
          captured_at: string
          cost_meter_key: string
          currency: string
          direction: string | null
          effective_from: string
          effective_to: string | null
          id: string
          imported_at: string
          meter_id: string
          note: string
          provider_account_id: string | null
          provider_key: string
          recorded_by: string | null
          region: string | null
          resource_type: string | null
          source: string
          source_url: string | null
          unit_amount_micros: number
        }
        Insert: {
          approval_state?: string
          captured_at?: string
          cost_meter_key: string
          currency: string
          direction?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          imported_at?: string
          meter_id: string
          note?: string
          provider_account_id?: string | null
          provider_key: string
          recorded_by?: string | null
          region?: string | null
          resource_type?: string | null
          source: string
          source_url?: string | null
          unit_amount_micros: number
        }
        Update: {
          approval_state?: string
          captured_at?: string
          cost_meter_key?: string
          currency?: string
          direction?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          imported_at?: string
          meter_id?: string
          note?: string
          provider_account_id?: string | null
          provider_key?: string
          recorded_by?: string | null
          region?: string | null
          resource_type?: string | null
          source?: string
          source_url?: string | null
          unit_amount_micros?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_rates_cost_meter_key_fkey"
            columns: ["cost_meter_key"]
            isOneToOne: false
            referencedRelation: "platform_provider_cost_meters"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "platform_provider_rates_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "platform_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_provider_rates_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
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
      platform_provider_service_features: {
        Row: {
          created_at: string
          feature_id: string
          note: string
          provider_service_id: string
          relationship: string
        }
        Insert: {
          created_at?: string
          feature_id: string
          note?: string
          provider_service_id: string
          relationship?: string
        }
        Update: {
          created_at?: string
          feature_id?: string
          note?: string
          provider_service_id?: string
          relationship?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_service_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_provider_service_features_provider_service_id_fkey"
            columns: ["provider_service_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_services"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_provider_services: {
        Row: {
          auth_mode: string
          created_at: string
          description: string
          display_order: number
          docs_url: string | null
          family: string
          id: string
          implementation_state: string
          key: string
          kind: string
          label: string
          metadata: Json
          provider_key: string
          updated_at: string
          vendor_status: string
        }
        Insert: {
          auth_mode: string
          created_at?: string
          description?: string
          display_order?: number
          docs_url?: string | null
          family: string
          id?: string
          implementation_state: string
          key: string
          kind: string
          label: string
          metadata?: Json
          provider_key: string
          updated_at?: string
          vendor_status: string
        }
        Update: {
          auth_mode?: string
          created_at?: string
          description?: string
          display_order?: number
          docs_url?: string | null
          family?: string
          id?: string
          implementation_state?: string
          key?: string
          kind?: string
          label?: string
          metadata?: Json
          provider_key?: string
          updated_at?: string
          vendor_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_provider_services_provider_key_fkey"
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
          billing_interval: string | null
          captured_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          meter_id: string
          note: string
          organization_id: string | null
          plan_id: string | null
          recorded_by: string | null
          source: string
          source_url: string | null
          unit_amount_micros: number
        }
        Insert: {
          approval_state?: string
          billing_interval?: string | null
          captured_at?: string
          currency: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          meter_id: string
          note?: string
          organization_id?: string | null
          plan_id?: string | null
          recorded_by?: string | null
          source: string
          source_url?: string | null
          unit_amount_micros: number
        }
        Update: {
          approval_state?: string
          billing_interval?: string | null
          captured_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          meter_id?: string
          note?: string
          organization_id?: string | null
          plan_id?: string | null
          recorded_by?: string | null
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
          {
            foreignKeyName: "platform_retail_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_retail_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_retail_rates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          gold_public_organization_id: string | null
          gold_public_site_id: string | null
          operating_organization_id: string | null
          platform_public_domain: string | null
          singleton: boolean
          workflow_review_organization_id: string | null
        }
        Insert: {
          gold_public_organization_id?: string | null
          gold_public_site_id?: string | null
          operating_organization_id?: string | null
          platform_public_domain?: string | null
          singleton?: boolean
          workflow_review_organization_id?: string | null
        }
        Update: {
          gold_public_organization_id?: string | null
          gold_public_site_id?: string | null
          operating_organization_id?: string | null
          platform_public_domain?: string | null
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
            foreignKeyName: "platform_settings_operating_organization_fk"
            columns: ["operating_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_settings_operating_organization_fk"
            columns: ["operating_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
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
          capabilities: string[]
          created_at: string
          name: string
          user_id: string
        }
        Insert: {
          capabilities?: string[]
          created_at?: string
          name: string
          user_id: string
        }
        Update: {
          capabilities?: string[]
          created_at?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_support_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          organization_id: string
          page: string | null
          requested_by: string
          status: string
          subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          organization_id: string
          page?: string | null
          requested_by: string
          status?: string
          subject: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          organization_id?: string
          page?: string | null
          requested_by?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_support_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_support_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
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
      portal_definitions: {
        Row: {
          created_at: string
          created_by: string
          draft_content: Json
          draft_status: string
          draft_version: number
          id: string
          organization_id: string
          published_revision_id: string | null
          revision_number: number
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_content: Json
          draft_status?: string
          draft_version?: number
          id?: string
          organization_id: string
          published_revision_id?: string | null
          revision_number?: number
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_content?: Json
          draft_status?: string
          draft_version?: number
          id?: string
          organization_id?: string
          published_revision_id?: string | null
          revision_number?: number
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_definitions_organization_id_published_revision_id_fkey"
            columns: ["organization_id", "published_revision_id"]
            isOneToOne: false
            referencedRelation: "portal_revisions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      portal_forms: {
        Row: {
          created_at: string
          created_by: string
          form_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          form_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          form_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_forms_organization_id_form_id_fkey"
            columns: ["organization_id", "form_id"]
            isOneToOne: true
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      portal_revisions: {
        Row: {
          content: Json
          id: string
          number: number
          organization_id: string
          portal_id: string
          published_at: string
          published_by: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          content: Json
          id?: string
          number: number
          organization_id: string
          portal_id: string
          published_at?: string
          published_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          content?: Json
          id?: string
          number?: number
          organization_id?: string
          portal_id?: string
          published_at?: string
          published_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_revisions_organization_id_portal_id_fkey"
            columns: ["organization_id", "portal_id"]
            isOneToOne: false
            referencedRelation: "portal_definitions"
            referencedColumns: ["organization_id", "id"]
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
      public_page_templates: {
        Row: {
          category: string
          created_at: string
          description: string
          display_order: number
          id: string
          key: string
          name: string
          page: Json
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          display_order?: number
          id?: string
          key: string
          name: string
          page: Json
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          name?: string
          page?: Json
        }
        Relationships: []
      }
      public_section_patterns: {
        Row: {
          created_at: string
          description: string
          display_order: number
          id: string
          key: string
          kind: string
          name: string
          section: Json
        }
        Insert: {
          created_at?: string
          description: string
          display_order?: number
          id?: string
          key: string
          kind: string
          name: string
          section: Json
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          kind?: string
          name?: string
          section?: Json
        }
        Relationships: []
      }
      public_site_revisions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_source: string
          id: string
          navigation: Json
          organization_id: string
          pages: Json
          published_at: string | null
          published_by: string | null
          revision_number: number
          site_id: string
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
          navigation?: Json
          organization_id: string
          pages: Json
          published_at?: string | null
          published_by?: string | null
          revision_number: number
          site_id: string
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
          navigation?: Json
          organization_id?: string
          pages?: Json
          published_at?: string | null
          published_by?: string | null
          revision_number?: number
          site_id?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_site_revisions_organization_id_site_id_fkey"
            columns: ["organization_id", "site_id"]
            isOneToOne: false
            referencedRelation: "public_sites"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      public_site_templates: {
        Row: {
          category: string
          created_at: string
          description: string
          display_order: number
          id: string
          key: string
          name: string
          navigation: Json
          pages: Json
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          display_order?: number
          id?: string
          key: string
          name: string
          navigation?: Json
          pages: Json
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          key?: string
          name?: string
          navigation?: Json
          pages?: Json
        }
        Relationships: []
      }
      public_sites: {
        Row: {
          created_at: string
          created_by: string | null
          current_published_revision_id: string | null
          default_locale: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_published_revision_id?: string | null
          default_locale?: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_published_revision_id?: string | null
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
          {
            foreignKeyName: "public_sites_published_revision_belongs_to_site"
            columns: ["organization_id", "id", "current_published_revision_id"]
            isOneToOne: false
            referencedRelation: "public_site_revisions"
            referencedColumns: ["organization_id", "site_id", "id"]
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
      resource_availability_exceptions: {
        Row: {
          created_at: string
          created_by: string
          ends_at: string
          id: string
          kind: string
          organization_id: string
          reason: string | null
          resource_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_at: string
          id?: string
          kind?: string
          organization_id: string
          reason?: string | null
          resource_id: string
          starts_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          kind?: string
          organization_id?: string
          reason?: string | null
          resource_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_availability_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_availability_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_availability_exceptions_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "resource_availability_exceptions_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      resource_capabilities: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_capabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_capability_assignments: {
        Row: {
          capability_id: string
          created_at: string
          created_by: string
          organization_id: string
          resource_id: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          created_by: string
          organization_id: string
          resource_id: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          created_by?: string
          organization_id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_capability_assignments_capability_same_org"
            columns: ["organization_id", "capability_id"]
            isOneToOne: false
            referencedRelation: "resource_capabilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "resource_capability_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_capability_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_capability_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "resource_capability_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      resource_working_hours: {
        Row: {
          closes_at: string
          created_at: string
          created_by: string
          day_of_week: number
          id: string
          opens_at: string
          organization_id: string
          resource_id: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          created_by: string
          day_of_week: number
          id?: string
          opens_at: string
          organization_id: string
          resource_id: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          created_by?: string
          day_of_week?: number
          id?: string
          opens_at?: string
          organization_id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_working_hours_schedule_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resource_working_schedules"
            referencedColumns: ["organization_id", "resource_id"]
          },
        ]
      }
      resource_working_schedules: {
        Row: {
          created_at: string
          created_by: string
          organization_id: string
          resource_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          organization_id: string
          resource_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          organization_id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_working_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_working_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_working_schedules_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: true
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "resource_working_schedules_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: true
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      resources: {
        Row: {
          base_location_id: string | null
          created_at: string
          created_by: string
          custom: Json
          id: string
          membership_id: string | null
          name: string
          organization_id: string
          resource_class: string
          travel_mode: string | null
        }
        Insert: {
          base_location_id?: string | null
          created_at?: string
          created_by: string
          custom?: Json
          id?: string
          membership_id?: string | null
          name: string
          organization_id: string
          resource_class: string
          travel_mode?: string | null
        }
        Update: {
          base_location_id?: string | null
          created_at?: string
          created_by?: string
          custom?: Json
          id?: string
          membership_id?: string | null
          name?: string
          organization_id?: string
          resource_class?: string
          travel_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_base_location_same_org"
            columns: ["organization_id", "base_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "resources_membership_same_org"
            columns: ["organization_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
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
      secret_references: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key: string
          label: string
          last_resolved_at: string | null
          organization_id: string
          purpose: string
          rotated_at: string | null
          secret_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key: string
          label: string
          last_resolved_at?: string | null
          organization_id: string
          purpose?: string
          rotated_at?: string | null
          secret_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key?: string
          label?: string
          last_resolved_at?: string | null
          organization_id?: string
          purpose?: string
          rotated_at?: string | null
          secret_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "secret_references_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secret_references_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_disclosure_deliverables: {
        Row: {
          deliverable_id: string
          engagement_id: string
          kind: string
          organization_id: string
          position: number
          revision_id: string
          status: string
          summary: string
          title: string
          url: string | null
        }
        Insert: {
          deliverable_id: string
          engagement_id: string
          kind: string
          organization_id: string
          position: number
          revision_id: string
          status: string
          summary: string
          title: string
          url?: string | null
        }
        Update: {
          deliverable_id?: string
          engagement_id?: string
          kind?: string
          organization_id?: string
          position?: number
          revision_id?: string
          status?: string
          summary?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_disclosure_deliverab_organization_id_engagement_i_fkey1"
            columns: ["organization_id", "engagement_id", "deliverable_id"]
            isOneToOne: false
            referencedRelation: "engagement_deliverables"
            referencedColumns: ["organization_id", "engagement_id", "id"]
          },
          {
            foreignKeyName: "service_disclosure_deliverabl_organization_id_engagement_i_fkey"
            columns: ["organization_id", "engagement_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "service_disclosure_revisions"
            referencedColumns: ["organization_id", "engagement_id", "id"]
          },
        ]
      }
      service_disclosure_revisions: {
        Row: {
          content: Json
          customer_id: string
          disclosure_id: string
          engagement_id: string
          engagement_status: string
          id: string
          number: number
          organization_id: string
          published_at: string
          published_by: string
        }
        Insert: {
          content: Json
          customer_id: string
          disclosure_id: string
          engagement_id: string
          engagement_status: string
          id?: string
          number: number
          organization_id: string
          published_at?: string
          published_by: string
        }
        Update: {
          content?: Json
          customer_id?: string
          disclosure_id?: string
          engagement_id?: string
          engagement_status?: string
          id?: string
          number?: number
          organization_id?: string
          published_at?: string
          published_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_disclosure_revisions_organization_id_customer_id_e_fkey"
            columns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "disclosure_id",
            ]
            isOneToOne: false
            referencedRelation: "service_disclosures"
            referencedColumns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "id",
            ]
          },
        ]
      }
      service_disclosures: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          draft_content: Json
          engagement_id: string
          id: string
          organization_id: string
          published_revision_id: string | null
          revision_number: number
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          draft_content: Json
          engagement_id: string
          id?: string
          organization_id: string
          published_revision_id?: string | null
          revision_number?: number
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          draft_content?: Json
          engagement_id?: string
          id?: string
          organization_id?: string
          published_revision_id?: string | null
          revision_number?: number
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_disclosures_organization_id_customer_id_engagement_fkey"
            columns: ["organization_id", "customer_id", "engagement_id"]
            isOneToOne: false
            referencedRelation: "service_engagements"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "service_disclosures_organization_id_id_published_revision__fkey"
            columns: ["organization_id", "id", "published_revision_id"]
            isOneToOne: false
            referencedRelation: "service_disclosure_revisions"
            referencedColumns: ["organization_id", "disclosure_id", "id"]
          },
        ]
      }
      service_engagements: {
        Row: {
          accepted_terms: Json | null
          completed_at: string | null
          created_at: string
          created_by: string
          customer_id: string
          ended_at: string | null
          id: string
          name: string
          opportunity_id: string | null
          organization_id: string
          proposal_id: string | null
          relationship_id: string | null
          service_kind: string
          started_at: string | null
          status: string
          tenant_organization_id: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          accepted_terms?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          ended_at?: string | null
          id?: string
          name: string
          opportunity_id?: string | null
          organization_id: string
          proposal_id?: string | null
          relationship_id?: string | null
          service_kind: string
          started_at?: string | null
          status?: string
          tenant_organization_id?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          accepted_terms?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          ended_at?: string | null
          id?: string
          name?: string
          opportunity_id?: string | null
          organization_id?: string
          proposal_id?: string | null
          relationship_id?: string | null
          service_kind?: string
          started_at?: string | null
          status?: string
          tenant_organization_id?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_engagements_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_engagements_organization_id_customer_id_opportunit_fkey"
            columns: ["organization_id", "customer_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "service_engagements_organization_id_customer_id_opportunit_fkey"
            columns: ["organization_id", "customer_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_worklist"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "service_engagements_organization_id_customer_id_relationsh_fkey"
            columns: [
              "organization_id",
              "customer_id",
              "relationship_id",
              "tenant_organization_id",
            ]
            isOneToOne: false
            referencedRelation: "client_tenant_relationships"
            referencedColumns: [
              "organization_id",
              "customer_id",
              "id",
              "tenant_organization_id",
            ]
          },
          {
            foreignKeyName: "service_engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_engagements_organization_id_proposal_id_fkey"
            columns: ["organization_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "customer_commercial_proposals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      service_notification_attempts: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: string
          intent_id: string
          message_id: string
          organization_id: string
          outcome: string | null
          started_at: string
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id: string
          intent_id: string
          message_id: string
          organization_id: string
          outcome?: string | null
          started_at?: string
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          intent_id?: string
          message_id?: string
          organization_id?: string
          outcome?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_notification_attempts_organization_id_intent_id_fkey"
            columns: ["organization_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "service_notification_intents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_notification_attempts_organization_id_message_id_fkey"
            columns: ["organization_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      service_notification_intents: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          disclosure_id: string
          email_address: string | null
          email_identity_id: string | null
          engagement_id: string
          id: string
          organization_id: string
          purpose: string
          reason: string | null
          recipient_id: string | null
          requested: boolean
          review_id: string | null
          revision_id: string
          state: string
          template_version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          disclosure_id: string
          email_address?: string | null
          email_identity_id?: string | null
          engagement_id: string
          id?: string
          organization_id: string
          purpose: string
          reason?: string | null
          recipient_id?: string | null
          requested: boolean
          review_id?: string | null
          revision_id: string
          state: string
          template_version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          disclosure_id?: string
          email_address?: string | null
          email_identity_id?: string | null
          engagement_id?: string
          id?: string
          organization_id?: string
          purpose?: string
          reason?: string | null
          recipient_id?: string | null
          requested?: boolean
          review_id?: string | null
          revision_id?: string
          state?: string
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_notification_intents_organization_id_customer_id_e_fkey"
            columns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "disclosure_id",
              "revision_id",
            ]
            isOneToOne: false
            referencedRelation: "service_disclosure_revisions"
            referencedColumns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "disclosure_id",
              "id",
            ]
          },
          {
            foreignKeyName: "service_notification_intents_organization_id_customer_id_r_fkey"
            columns: ["organization_id", "customer_id", "recipient_id"]
            isOneToOne: false
            referencedRelation: "customer_notification_recipients"
            referencedColumns: ["organization_id", "customer_id", "id"]
          },
          {
            foreignKeyName: "service_notification_intents_organization_id_email_identit_fkey"
            columns: ["organization_id", "email_identity_id"]
            isOneToOne: false
            referencedRelation: "email_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_notification_intents_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "service_reviews"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      service_reviews: {
        Row: {
          change_description: string | null
          customer_id: string
          deliverable_id: string | null
          disclosure_id: string
          engagement_id: string
          finished_at: string | null
          finished_by: string | null
          id: string
          organization_id: string
          portal_invite_id: string | null
          released_at: string
          released_by: string
          responder_name: string | null
          revision_id: string
          state: string
          support_case_id: string | null
          version: number
        }
        Insert: {
          change_description?: string | null
          customer_id: string
          deliverable_id?: string | null
          disclosure_id: string
          engagement_id: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          organization_id: string
          portal_invite_id?: string | null
          released_at?: string
          released_by: string
          responder_name?: string | null
          revision_id: string
          state?: string
          support_case_id?: string | null
          version?: number
        }
        Update: {
          change_description?: string | null
          customer_id?: string
          deliverable_id?: string | null
          disclosure_id?: string
          engagement_id?: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          organization_id?: string
          portal_invite_id?: string | null
          released_at?: string
          released_by?: string
          responder_name?: string | null
          revision_id?: string
          state?: string
          support_case_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_reviews_organization_id_customer_id_engagement_id__fkey"
            columns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "disclosure_id",
              "revision_id",
            ]
            isOneToOne: false
            referencedRelation: "service_disclosure_revisions"
            referencedColumns: [
              "organization_id",
              "customer_id",
              "engagement_id",
              "disclosure_id",
              "id",
            ]
          },
          {
            foreignKeyName: "service_reviews_organization_id_portal_invite_id_fkey"
            columns: ["organization_id", "portal_invite_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_invites"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_reviews_organization_id_revision_id_deliverable_id_fkey"
            columns: ["organization_id", "revision_id", "deliverable_id"]
            isOneToOne: true
            referencedRelation: "service_disclosure_deliverables"
            referencedColumns: [
              "organization_id",
              "revision_id",
              "deliverable_id",
            ]
          },
          {
            foreignKeyName: "service_reviews_organization_id_support_case_id_fkey"
            columns: ["organization_id", "support_case_id"]
            isOneToOne: false
            referencedRelation: "support_case_records"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_reviews_organization_id_support_case_id_fkey"
            columns: ["organization_id", "support_case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      support_case_counters: {
        Row: {
          last_number: number
          organization_id: string
        }
        Insert: {
          last_number: number
          organization_id: string
        }
        Update: {
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_case_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_case_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_case_events: {
        Row: {
          actor_id: string
          actor_name: string
          body: string
          case_id: string
          id: string
          kind: string
          new_value: Json | null
          occurred_at: string
          organization_id: string
          previous_value: Json | null
        }
        Insert: {
          actor_id: string
          actor_name: string
          body?: string
          case_id: string
          id?: string
          kind: string
          new_value?: Json | null
          occurred_at?: string
          organization_id: string
          previous_value?: Json | null
        }
        Update: {
          actor_id?: string
          actor_name?: string
          body?: string
          case_id?: string
          id?: string
          kind?: string
          new_value?: Json | null
          occurred_at?: string
          organization_id?: string
          previous_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "support_case_events_organization_id_case_id_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "support_case_records"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_events_organization_id_case_id_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      support_case_links: {
        Row: {
          asset_id: string | null
          call_id: string | null
          case_id: string
          conversation_id: string | null
          created_at: string
          id: string
          invoice_id: string | null
          location_id: string | null
          organization_id: string
          work_item_id: string | null
        }
        Insert: {
          asset_id?: string | null
          call_id?: string | null
          case_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          location_id?: string | null
          organization_id: string
          work_item_id?: string | null
        }
        Update: {
          asset_id?: string | null
          call_id?: string | null
          case_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          location_id?: string | null
          organization_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_case_links_organization_id_asset_id_fkey"
            columns: ["organization_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_case_id_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "support_case_records"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_case_id_fkey"
            columns: ["organization_id", "case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_invoice_records"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "support_case_links_organization_id_work_item_id_fkey"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      support_cases: {
        Row: {
          assigned_membership_id: string | null
          case_number: string
          closed_at: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          description: string
          escalated_at: string | null
          id: string
          organization_id: string
          policy_id: string | null
          priority: string
          queue_id: string | null
          resolution_due_at: string | null
          resolution_summary: string | null
          resolved_at: string | null
          status: string
          target_snapshot: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_membership_id?: string | null
          case_number: string
          closed_at?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          description?: string
          escalated_at?: string | null
          id?: string
          organization_id: string
          policy_id?: string | null
          priority?: string
          queue_id?: string | null
          resolution_due_at?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          status?: string
          target_snapshot?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_membership_id?: string | null
          case_number?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          description?: string
          escalated_at?: string | null
          id?: string
          organization_id?: string
          policy_id?: string | null
          priority?: string
          queue_id?: string | null
          resolution_due_at?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          status?: string
          target_snapshot?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_organization_id_assigned_membership_id_fkey"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_policy_id_fkey"
            columns: ["organization_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "support_service_levels"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_queue_id_fkey"
            columns: ["organization_id", "queue_id"]
            isOneToOne: false
            referencedRelation: "support_queues"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      support_queues: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_queues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_queues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_service_levels: {
        Row: {
          active: boolean
          clock_basis: string
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          priority: string
          queue_id: string | null
          target_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          clock_basis?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          priority: string
          queue_id?: string | null
          target_minutes: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          clock_basis?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          priority?: string
          queue_id?: string | null
          target_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_service_levels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_service_levels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_service_levels_organization_id_queue_id_fkey"
            columns: ["organization_id", "queue_id"]
            isOneToOne: false
            referencedRelation: "support_queues"
            referencedColumns: ["organization_id", "id"]
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
      usage_cost_component_adjustments: {
        Row: {
          cost_component_id: string
          id: string
          native_cost_micros: number
          native_currency: string
          note: string
          organization_id: string
          provider_reference: string
          recorded_at: string
          recorded_by: string | null
          source: string
          state: string
        }
        Insert: {
          cost_component_id: string
          id?: string
          native_cost_micros: number
          native_currency: string
          note?: string
          organization_id: string
          provider_reference?: string
          recorded_at?: string
          recorded_by?: string | null
          source: string
          state: string
        }
        Update: {
          cost_component_id?: string
          id?: string
          native_cost_micros?: number
          native_currency?: string
          note?: string
          organization_id?: string
          provider_reference?: string
          recorded_at?: string
          recorded_by?: string | null
          source?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_cost_component_adjustme_organization_id_cost_compone_fkey"
            columns: ["organization_id", "cost_component_id"]
            isOneToOne: false
            referencedRelation: "usage_cost_components"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "usage_cost_component_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_component_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_cost_components: {
        Row: {
          component_key: string
          cost_meter_key: string
          cost_state: string
          created_at: string
          fx_rate: number | null
          fx_rate_id: string | null
          id: string
          native_cost_micros: number | null
          native_currency: string | null
          occurred_at: string
          organization_id: string
          provider_account_id: string | null
          provider_binding_id: string | null
          provider_key: string
          provider_rate_id: string | null
          provider_resource_id: string | null
          quantity: number
          reporting_cost_micros: number | null
          reporting_currency: string | null
          unit: string
          unknown_reason: string | null
          usage_event_id: string
        }
        Insert: {
          component_key: string
          cost_meter_key: string
          cost_state: string
          created_at?: string
          fx_rate?: number | null
          fx_rate_id?: string | null
          id?: string
          native_cost_micros?: number | null
          native_currency?: string | null
          occurred_at: string
          organization_id: string
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_key: string
          provider_rate_id?: string | null
          provider_resource_id?: string | null
          quantity: number
          reporting_cost_micros?: number | null
          reporting_currency?: string | null
          unit: string
          unknown_reason?: string | null
          usage_event_id: string
        }
        Update: {
          component_key?: string
          cost_meter_key?: string
          cost_state?: string
          created_at?: string
          fx_rate?: number | null
          fx_rate_id?: string | null
          id?: string
          native_cost_micros?: number | null
          native_currency?: string | null
          occurred_at?: string
          organization_id?: string
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_key?: string
          provider_rate_id?: string | null
          provider_resource_id?: string | null
          quantity?: number
          reporting_cost_micros?: number | null
          reporting_currency?: string | null
          unit?: string
          unknown_reason?: string | null
          usage_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_cost_components_cost_meter_key_fkey"
            columns: ["cost_meter_key"]
            isOneToOne: false
            referencedRelation: "platform_provider_cost_meters"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "usage_cost_components_fx_rate_id_fkey"
            columns: ["fx_rate_id"]
            isOneToOne: false
            referencedRelation: "platform_fx_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_components_organization_id_provider_binding_id__fkey"
            columns: ["organization_id", "provider_binding_id", "provider_key"]
            isOneToOne: false
            referencedRelation: "organization_provider_bindings"
            referencedColumns: ["organization_id", "id", "provider_key"]
          },
          {
            foreignKeyName: "usage_cost_components_organization_id_provider_binding_id_fkey1"
            columns: [
              "organization_id",
              "provider_binding_id",
              "provider_resource_id",
            ]
            isOneToOne: false
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "binding_id", "id"]
          },
          {
            foreignKeyName: "usage_cost_components_organization_id_usage_event_id_fkey"
            columns: ["organization_id", "usage_event_id"]
            isOneToOne: false
            referencedRelation: "usage_events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "usage_cost_components_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_cost_components_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "platform_providers"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "usage_cost_components_provider_rate_id_fkey"
            columns: ["provider_rate_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_rates"
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
          allowance_consumed_before: number | null
          allowance_included_applied: number | null
          allowance_included_total: number | null
          allowance_key: string | null
          allowance_overage_quantity: number | null
          allowance_window_basis: string | null
          allowance_window_end: string | null
          allowance_window_start: string | null
          billing_period: string | null
          created_at: string
          customer_charge_micros: number | null
          customer_currency: string | null
          feature_id: string | null
          fulfilled_through: string
          id: string
          meter_id: string
          note: string
          occurred_at: string
          organization_id: string
          provider_account_id: string | null
          provider_binding_id: string | null
          provider_cost_applicable: boolean
          provider_cost_micros: number | null
          provider_currency: string | null
          provider_key: string
          provider_rate_id: string | null
          provider_resource_id: string | null
          quantity: number
          reference: string | null
          retail_rate_id: string | null
          source_domain: string
          source_record_id: string | null
        }
        Insert: {
          allowance_consumed_before?: number | null
          allowance_included_applied?: number | null
          allowance_included_total?: number | null
          allowance_key?: string | null
          allowance_overage_quantity?: number | null
          allowance_window_basis?: string | null
          allowance_window_end?: string | null
          allowance_window_start?: string | null
          billing_period?: string | null
          created_at?: string
          customer_charge_micros?: number | null
          customer_currency?: string | null
          feature_id?: string | null
          fulfilled_through?: string
          id?: string
          meter_id: string
          note?: string
          occurred_at?: string
          organization_id: string
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_cost_applicable?: boolean
          provider_cost_micros?: number | null
          provider_currency?: string | null
          provider_key: string
          provider_rate_id?: string | null
          provider_resource_id?: string | null
          quantity: number
          reference?: string | null
          retail_rate_id?: string | null
          source_domain?: string
          source_record_id?: string | null
        }
        Update: {
          allowance_consumed_before?: number | null
          allowance_included_applied?: number | null
          allowance_included_total?: number | null
          allowance_key?: string | null
          allowance_overage_quantity?: number | null
          allowance_window_basis?: string | null
          allowance_window_end?: string | null
          allowance_window_start?: string | null
          billing_period?: string | null
          created_at?: string
          customer_charge_micros?: number | null
          customer_currency?: string | null
          feature_id?: string | null
          fulfilled_through?: string
          id?: string
          meter_id?: string
          note?: string
          occurred_at?: string
          organization_id?: string
          provider_account_id?: string | null
          provider_binding_id?: string | null
          provider_cost_applicable?: boolean
          provider_cost_micros?: number | null
          provider_currency?: string | null
          provider_key?: string
          provider_rate_id?: string | null
          provider_resource_id?: string | null
          quantity?: number
          reference?: string | null
          retail_rate_id?: string | null
          source_domain?: string
          source_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_account_same_provider"
            columns: ["provider_account_id", "provider_key"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
            referencedColumns: ["id", "provider_key"]
          },
          {
            foreignKeyName: "usage_events_binding_same_org_and_provider"
            columns: ["organization_id", "provider_binding_id", "provider_key"]
            isOneToOne: false
            referencedRelation: "organization_provider_bindings"
            referencedColumns: ["organization_id", "id", "provider_key"]
          },
          {
            foreignKeyName: "usage_events_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "platform_catalog_features"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "usage_events_provider_rate_matches"
            columns: [
              "provider_rate_id",
              "meter_id",
              "provider_key",
              "provider_currency",
            ]
            isOneToOne: false
            referencedRelation: "platform_provider_rates"
            referencedColumns: ["id", "meter_id", "provider_key", "currency"]
          },
          {
            foreignKeyName: "usage_events_resource_same_org_and_binding"
            columns: [
              "organization_id",
              "provider_binding_id",
              "provider_resource_id",
            ]
            isOneToOne: false
            referencedRelation: "organization_provider_resources"
            referencedColumns: ["organization_id", "binding_id", "id"]
          },
          {
            foreignKeyName: "usage_events_retail_rate_matches"
            columns: ["retail_rate_id", "meter_id", "customer_currency"]
            isOneToOne: false
            referencedRelation: "platform_retail_rates"
            referencedColumns: ["id", "meter_id", "currency"]
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
            referencedRelation: "phone_number_readiness"
            referencedColumns: ["organization_id", "phone_number_id"]
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
      voice_agent_events: {
        Row: {
          event_id: string
          event_type: string
          received_at: string
          session_id: string
        }
        Insert: {
          event_id: string
          event_type: string
          received_at?: string
          session_id: string
        }
        Update: {
          event_id?: string
          event_type?: string
          received_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_agent_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "voice_agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_agent_sessions: {
        Row: {
          call_id: string
          config_revision: number
          connection_url: string | null
          created_at: string
          deployment_ref: string
          external_session_id: string | null
          id: string
          max_seconds: number
          model: string
          organization_id: string
          provider_account_id: string
          reported_seconds: number | null
          route_id: string
          state: string
        }
        Insert: {
          call_id: string
          config_revision: number
          connection_url?: string | null
          created_at?: string
          deployment_ref: string
          external_session_id?: string | null
          id?: string
          max_seconds: number
          model: string
          organization_id: string
          provider_account_id: string
          reported_seconds?: number | null
          route_id: string
          state?: string
        }
        Update: {
          call_id?: string
          config_revision?: number
          connection_url?: string | null
          created_at?: string
          deployment_ref?: string
          external_session_id?: string | null
          id?: string
          max_seconds?: number
          model?: string
          organization_id?: string
          provider_account_id?: string
          reported_seconds?: number | null
          route_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_agent_sessions_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "voice_inbound_contexts"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "voice_agent_sessions_call_same_org"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "voice_agent_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_agent_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_agent_sessions_organization_id_route_id_fkey"
            columns: ["organization_id", "route_id"]
            isOneToOne: false
            referencedRelation: "communication_routes"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "voice_agent_sessions_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "platform_provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_inbound_contexts: {
        Row: {
          account_sid: string
          call_id: string
          context: Json
          external_id: string
        }
        Insert: {
          account_sid: string
          call_id: string
          context: Json
          external_id: string
        }
        Update: {
          account_sid?: string
          call_id?: string
          context?: Json
          external_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_inbound_contexts_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_inbound_cursors: {
        Row: {
          call_id: string
          cursor_value: number
          route_id: string
        }
        Insert: {
          call_id: string
          cursor_value: number
          route_id: string
        }
        Update: {
          call_id?: string
          cursor_value?: number
          route_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_inbound_cursors_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "voice_inbound_contexts"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "voice_inbound_cursors_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "communication_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_receptionist_configs: {
        Row: {
          deployment_ref: string
          enabled: boolean
          max_session_seconds: number
          monthly_budget_seconds: number
          organization_id: string
          revision: number
        }
        Insert: {
          deployment_ref: string
          enabled?: boolean
          max_session_seconds: number
          monthly_budget_seconds: number
          organization_id: string
          revision?: number
        }
        Update: {
          deployment_ref?: string
          enabled?: boolean
          max_session_seconds?: number
          monthly_budget_seconds?: number
          organization_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "voice_receptionist_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_receptionist_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "work_item_priced_lines_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_resource_assignments: {
        Row: {
          created_at: string
          created_by: string
          occupies: unknown
          organization_id: string
          resource_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          occupies?: unknown
          organization_id: string
          resource_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          occupies?: unknown
          organization_id?: string
          resource_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_resource_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_work_item_same_org"
            columns: ["organization_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_work_item_same_org"
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
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
      work_item_type_resource_requirement_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          created_by: string
          organization_id: string
          requirement_id: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          created_by: string
          organization_id: string
          requirement_id: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          created_by?: string
          organization_id?: string
          requirement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirement_capabilities_capability_same_org"
            columns: ["organization_id", "capability_id"]
            isOneToOne: false
            referencedRelation: "resource_capabilities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "requirement_capabilities_requirement_same_org"
            columns: ["organization_id", "requirement_id"]
            isOneToOne: false
            referencedRelation: "work_item_type_resource_requirements"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_type_resource_requirement_capabi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_type_resource_requirement_capabi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_type_resource_requirements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          position: number
          quantity: number
          resource_class: string
          type_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          position?: number
          quantity: number
          resource_class: string
          type_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          position?: number
          quantity?: number
          resource_class?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_type_resource_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_type_resource_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_type_resource_requirements_type_same_org"
            columns: ["organization_id", "type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      work_item_types: {
        Row: {
          booking_allow_same_day: boolean
          booking_cadence_minutes: number | null
          booking_cancel_cutoff_minutes: number | null
          booking_cancellation_status_id: string | null
          booking_duration_minutes: number | null
          booking_horizon_days: number
          booking_intake_form_id: string | null
          booking_minimum_notice_minutes: number
          booking_price_item_id: string | null
          booking_reschedule_cutoff_minutes: number | null
          booking_status_id: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          schedulable: boolean
        }
        Insert: {
          booking_allow_same_day?: boolean
          booking_cadence_minutes?: number | null
          booking_cancel_cutoff_minutes?: number | null
          booking_cancellation_status_id?: string | null
          booking_duration_minutes?: number | null
          booking_horizon_days?: number
          booking_intake_form_id?: string | null
          booking_minimum_notice_minutes?: number
          booking_price_item_id?: string | null
          booking_reschedule_cutoff_minutes?: number | null
          booking_status_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          schedulable: boolean
        }
        Update: {
          booking_allow_same_day?: boolean
          booking_cadence_minutes?: number | null
          booking_cancel_cutoff_minutes?: number | null
          booking_cancellation_status_id?: string | null
          booking_duration_minutes?: number | null
          booking_horizon_days?: number
          booking_intake_form_id?: string | null
          booking_minimum_notice_minutes?: number
          booking_price_item_id?: string | null
          booking_reschedule_cutoff_minutes?: number | null
          booking_status_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          schedulable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "work_item_types_booking_cancellation_status_same_type"
            columns: ["organization_id", "id", "booking_cancellation_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["organization_id", "type_id", "id"]
          },
          {
            foreignKeyName: "work_item_types_booking_intake_same_org"
            columns: ["organization_id", "booking_intake_form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["organization_id", "id"]
          },
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
      finance_invoice_records: {
        Row: {
          billed_to: string | null
          created_by: string | null
          currency: string | null
          customer_id: string | null
          due_at: string | null
          id: string | null
          issued_at: string | null
          number: number | null
          organization_id: string | null
          outstanding_minor: number | null
          overdue: boolean | null
          paid_minor: number | null
          settled: boolean | null
          total_minor: number | null
          work_item_id: string | null
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
            referencedRelation: "finance_quote_records"
            referencedColumns: ["organization_id", "work_item_id"]
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
      finance_payment_records: {
        Row: {
          amount_minor: number | null
          billed_to: string | null
          created_by: string | null
          currency: string | null
          customer_id: string | null
          id: string | null
          invoice_id: string | null
          invoice_number: number | null
          note: string | null
          organization_id: string | null
          provider: string | null
          provider_reference: string | null
          received_at: string | null
          work_item_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_same_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_invoice_records"
            referencedColumns: ["organization_id", "id"]
          },
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
      finance_quote_records: {
        Row: {
          created_at: string | null
          currency: string | null
          customer_id: string | null
          customer_name: string | null
          invoiced: boolean | null
          line_count: number | null
          organization_id: string | null
          status: string | null
          title: string | null
          total_minor: number | null
          work_item_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_items_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
        ]
      }
      opportunity_worklist: {
        Row: {
          amount_minor: number | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_id: string | null
          expected_close_on: string | null
          has_future_follow_up: boolean | null
          id: string | null
          next_follow_up_due_at: string | null
          next_follow_up_id: string | null
          next_follow_up_title: string | null
          organization_id: string | null
          owner_membership_id: string | null
          stage_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_customer_same_org"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_same_org"
            columns: ["organization_id", "owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "opportunities_stage_same_org"
            columns: ["organization_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "opportunity_stages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      phone_number_readiness: {
        Row: {
          organization_id: string | null
          phone_number_id: string | null
          readiness: string | null
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
            foreignKeyName: "work_item_resource_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "bookable_resources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "work_item_resource_assignments_resource_same_org"
            columns: ["organization_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      support_case_records: {
        Row: {
          assigned_membership_id: string | null
          case_number: string | null
          closed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          description: string | null
          escalated_at: string | null
          id: string | null
          organization_id: string | null
          owner_name: string | null
          policy_id: string | null
          priority: string | null
          queue_id: string | null
          queue_name: string | null
          resolution_due_at: string | null
          resolution_summary: string | null
          resolved_at: string | null
          status: string | null
          target_snapshot: Json | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_organization_id_assigned_membership_id_fkey"
            columns: ["organization_id", "assigned_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_policy_id_fkey"
            columns: ["organization_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "support_service_levels"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_cases_organization_id_queue_id_fkey"
            columns: ["organization_id", "queue_id"]
            isOneToOne: false
            referencedRelation: "support_queues"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Functions: {
      accept_commercial_proposal: {
        Args: { p_proposal_id: string }
        Returns: undefined
      }
      accept_invitation: {
        Args: { p_display_name: string; p_token: string }
        Returns: string
      }
      add_automation_tool_action: {
        Args: {
          p_arguments: Json
          p_capability_key: string
          p_connection_id: string
          p_label: string
          p_organization_id: string
          p_resource_id?: string
          p_rule_id: string
        }
        Returns: string
      }
      add_call_participant: {
        Args: {
          p_call_id: string
          p_external_id?: string
          p_organization_id: string
          p_party: string
        }
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
      admit_voice_agent_session: {
        Args: { p_call_id: string; p_route_id: string }
        Returns: Json
      }
      advance_route_round_robin: {
        Args: { p_organization_id: string; p_route_id: string }
        Returns: number
      }
      ai_preview_configuration: {
        Args: {
          p_assistant_id: string
          p_organization_id: string
          p_version_id: string
        }
        Returns: Json
      }
      ai_published_sites: {
        Args: { p_organization_id: string }
        Returns: {
          current_published_revision_id: string
          id: string
        }[]
      }
      ai_workspace_summary: {
        Args: { p_organization_id: string; p_since: string }
        Returns: Json
      }
      allowance_decision: {
        Args: {
          p_allowance_key: string
          p_at?: string
          p_organization_id: string
          p_requested_quantity?: number
        }
        Returns: {
          allowance_key: string
          consumed: number
          detail: string
          enforcement: string
          governed: boolean
          hard_limit: number
          included: number
          included_applied: number
          label: string
          overage_applied: number
          overage_behavior: string
          permitted: boolean
          remaining: number
          result: string
          unit: string
          window_basis: string
          window_ends_at: string
          window_starts_at: string
        }[]
      }
      apply_import_run: {
        Args: { p_organization_id: string; p_run_id: string }
        Returns: undefined
      }
      apply_platform_subscription_event: {
        Args: {
          p_cancel_at_period_end: boolean
          p_canceled_at: number
          p_checkout_correlation: string
          p_currency: string
          p_current_period_end: number
          p_current_period_start: number
          p_customer_reference: string
          p_event_reference: string
          p_event_type: string
          p_items: Json
          p_provider?: string
          p_provider_event_created_at: number
          p_status: string
          p_subscription_reference: string
        }
        Returns: string
      }
      assign_conversation: {
        Args: {
          p_conversation_id: string
          p_membership_id: string
          p_organization_id: string
        }
        Returns: undefined
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
      assign_resource_capability: {
        Args: { p_capability_id: string; p_resource_id: string }
        Returns: undefined
      }
      assign_role: {
        Args: { p_membership_id: string; p_role_id: string }
        Returns: undefined
      }
      assistant_may_read_resource: {
        Args: { p_organization_id: string; p_resource_id: string }
        Returns: boolean
      }
      attach_engagement_deliverable: {
        Args: {
          p_artifact_id: string
          p_engagement_id: string
          p_kind: string
          p_organization_id: string
        }
        Returns: string
      }
      attach_engagement_work: {
        Args: {
          p_engagement_id: string
          p_organization_id: string
          p_work_item_id: string
        }
        Returns: undefined
      }
      attach_plan_addon: {
        Args: {
          p_addon_plan_id: string
          p_included_by_default?: boolean
          p_plan_id: string
        }
        Returns: undefined
      }
      authorize_assistant_tool_call: {
        Args: {
          p_arguments: Json
          p_assistant_id: string
          p_conversation_id?: string
          p_correlation?: string
          p_grant_id: string
          p_organization_id: string
          p_resource_value?: string
        }
        Returns: Json
      }
      authorize_automation_tool_call: {
        Args: {
          p_arguments: Json
          p_correlation?: string
          p_grant_id: string
          p_resource_value?: string
          p_rule_id: string
        }
        Returns: Json
      }
      authorize_customer_notification_send: {
        Args: { p_job_id: string; p_lease_id: string }
        Returns: boolean
      }
      automation_operating_summary: {
        Args: { p_organization_id: string; p_since: string; p_until: string }
        Returns: Json
      }
      begin_custom_domain_connection: {
        Args: {
          p_hostname: string
          p_organization_id: string
          p_surface: string
        }
        Returns: string
      }
      begin_email_test_send: {
        Args: { p_organization_id: string }
        Returns: {
          business_name: string
          from_address: string
          from_name: string
          id: string
          recipient: string
          reply_to: string
        }[]
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
      begin_inbound_routing: {
        Args: {
          p_account_sid: string
          p_external_id: string
          p_from_number: string
          p_to_number: string
        }
        Returns: Json
      }
      begin_platform_billing_portal_session: {
        Args: { p_organization_id: string }
        Returns: string
      }
      begin_provider_binding: {
        Args: {
          p_organization_id: string
          p_provider_account_id?: string
          p_provider_key: string
        }
        Returns: string
      }
      bind_service_engagement_tenant: {
        Args: {
          p_engagement_id: string
          p_organization_id: string
          p_relationship_id: string
        }
        Returns: undefined
      }
      bind_voice_agent_session: {
        Args: {
          p_connection_url: string
          p_external_id: string
          p_session_id: string
        }
        Returns: undefined
      }
      bookable_candidates: {
        Args: { p_type_id: string }
        Returns: {
          quantity: number
          req_position: number
          requirement_id: string
          resource_id: string
          resource_rank: number
        }[]
      }
      booking_change_options: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      booking_intake_available: { Args: { p_type_id: string }; Returns: Json }
      booking_organization: { Args: { p_slug: string }; Returns: string }
      booking_own_commitments: {
        Args: { p_work_item_id: string }
        Returns: {
          occupies: unknown
          resource_id: string
        }[]
      }
      bootstrap_gold_internal_workspace: {
        Args: {
          p_capabilities: string[]
          p_organization_id: string
          p_role: string
        }
        Returns: string
      }
      call_recording_reference: {
        Args: { p_call_id: string; p_organization_id: string }
        Returns: string
      }
      caller_operating_organization_id: { Args: never; Returns: string }
      can_manage_custom_domains: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      can_manage_email_domains: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      can_manage_integrations: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
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
      claim_conversation: {
        Args: { p_conversation_id: string; p_organization_id: string }
        Returns: boolean
      }
      claim_customer_notification: {
        Args: { p_job_id?: string }
        Returns: Json
      }
      claim_email_for_send: {
        Args: { p_message_id: string; p_organization_id: string }
        Returns: boolean
      }
      claim_inbound_route_cursor: {
        Args: { p_call_id: string; p_route_id: string }
        Returns: number
      }
      claim_integration_actions: {
        Args: { p_limit?: number }
        Returns: {
          arguments: Json
          attempts: number
          grant_id: string
          id: string
          rule_id: string
        }[]
      }
      claim_integration_library_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      claim_integration_resource_sync: {
        Args: { p_resource_id: string }
        Returns: Json
      }
      claim_message_deliveries: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          channel: string
          from_address: string
          from_name: string
          id: string
          provider_account_id: string
          provider_key: string
          recipient: string
          reply_to: string
          subject_line: string
        }[]
      }
      claim_operator_email_for_send: {
        Args: { p_message_id: string; p_organization_id: string }
        Returns: boolean
      }
      claim_portal_invite: { Args: { p_token: string }; Returns: string }
      claim_portal_invite_at_hostname: {
        Args: { p_hostname: string; p_token: string }
        Returns: string
      }
      claim_proposal_invite: { Args: { p_token: string }; Returns: string }
      claim_voice_agent_transfer: {
        Args: { p_session_id: string }
        Returns: Json
      }
      clear_integration_credential: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      clear_plan_feature_override: {
        Args: { p_feature_id: string; p_plan_id: string }
        Returns: undefined
      }
      client_tenant_summaries: {
        Args: { p_customer_id: string; p_organization_id: string }
        Returns: {
          created_at: string
          customer_id: string
          ended_at: string
          id: string
          may_open: boolean
          operational_state: string
          origin: string
          status: string
          tenant_name: string
          tenant_organization_id: string
        }[]
      }
      commit_integration_resource_sync: {
        Args: {
          p_complete: boolean
          p_cursor: Json
          p_error: string
          p_lease_id: string
          p_records: Json
          p_resource_id: string
          p_restart?: boolean
          p_snapshot: boolean
        }
        Returns: undefined
      }
      complete_integration_execution: {
        Args: {
          p_error_class?: string
          p_execution_id: string
          p_result?: Json
          p_result_bytes?: number
          p_succeeded: boolean
        }
        Returns: undefined
      }
      compose_organization_charges: {
        Args: {
          p_billing_period_end: string
          p_billing_period_start: string
          p_organization_id: string
        }
        Returns: {
          kind: string
          proration_required: boolean
          written: boolean
        }[]
      }
      configure_integration_resource_sync: {
        Args: { p_enabled: boolean; p_parameters: Json; p_resource_id: string }
        Returns: undefined
      }
      configure_phone_number: {
        Args: {
          p_label: string
          p_organization_id: string
          p_phone_number_id: string
          p_purpose: string
          p_sms_inbound: boolean
          p_sms_outbound: boolean
          p_voice_inbound: boolean
          p_voice_outbound: boolean
        }
        Returns: undefined
      }
      configure_voice_receptionist: {
        Args: {
          p_budget_seconds: number
          p_deployment_ref: string
          p_enabled: boolean
          p_max_seconds: number
          p_organization_id: string
          p_revision: number
        }
        Returns: undefined
      }
      confirm_external_card_payment: {
        Args: { p_provider_reference: string; p_request_id: string }
        Returns: undefined
      }
      confirm_notification_recipient: {
        Args: { p_challenge_id: string; p_code: string }
        Returns: boolean
      }
      consume_public_communication_rate_limit: {
        Args: { p_site_id: string; p_visitor_key: string }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      contact_gildops_support: {
        Args: {
          p_message: string
          p_organization_id: string
          p_page?: string
          p_subject: string
        }
        Returns: string
      }
      conversation_customer_candidates: {
        Args: { p_conversation_id: string; p_organization_id: string }
        Returns: {
          customer_id: string
          email: string
          name: string
          phone: string
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
          p_allocations: Json
          p_email: string
          p_intake_answers?: Json
          p_intake_revision_id?: string
          p_name: string
          p_organization_id: string
          p_phone: string
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
          p_content_sha256?: string
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
      create_form: {
        Args: {
          p_name: string
          p_organization_id: string
          p_template_key?: string
        }
        Returns: Json
      }
      create_form_draft: {
        Args: { p_form_id: string; p_organization_id: string }
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
          p_identity?: Json
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
      create_proposal_invite: {
        Args: { p_customer_id: string }
        Returns: string
      }
      create_public_site: {
        Args: { p_organization_id: string; p_template_key?: string }
        Returns: string
      }
      create_public_site_draft: {
        Args: { p_from_revision_id?: string; p_organization_id: string }
        Returns: string
      }
      create_resource: {
        Args: {
          p_capability_ids?: string[]
          p_custom: Json
          p_membership_id?: string
          p_name: string
          p_organization_id: string
          p_resource_class: string
        }
        Returns: string
      }
      create_resource_availability_exception: {
        Args: {
          p_ends_at: string
          p_reason: string
          p_resource_id: string
          p_starts_at: string
        }
        Returns: string
      }
      create_resource_capability: {
        Args: { p_name: string; p_organization_id: string }
        Returns: string
      }
      create_resource_requirement: {
        Args: {
          p_capability_ids: string[]
          p_quantity: number
          p_resource_class: string
          p_type_id: string
        }
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
      create_secret_reference: {
        Args: {
          p_key: string
          p_label: string
          p_organization_id: string
          p_purpose: string
          p_value: string
        }
        Returns: string
      }
      create_service_engagement: {
        Args: {
          p_customer_id: string
          p_name: string
          p_opportunity_id?: string
          p_organization_id: string
          p_proposal_id?: string
          p_relationship_id?: string
          p_service_kind: string
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
          p_resource_ids: string[]
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
        Args: {
          p_name: string
          p_organization_id: string
          p_schedulable: boolean
        }
        Returns: string
      }
      credit_balance: { Args: { p_organization_id: string }; Returns: number }
      crm_dashboard_summary: {
        Args: { p_month: string; p_organization_id: string }
        Returns: Json
      }
      crm_pipeline_preview: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: {
          amount_minor: number | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_id: string | null
          expected_close_on: string | null
          has_future_follow_up: boolean | null
          id: string | null
          next_follow_up_due_at: string | null
          next_follow_up_id: string | null
          next_follow_up_title: string | null
          organization_id: string | null
          owner_membership_id: string | null
          stage_id: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "opportunity_worklist"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      custom_domain_provider_account: {
        Args: { p_domain_id: string; p_organization_id: string }
        Returns: string
      }
      customer_cancel_booking: {
        Args: { p_work_item_id: string }
        Returns: undefined
      }
      customer_reschedule_booking: {
        Args: {
          p_allocations: Json
          p_starts_at: string
          p_work_item_id: string
        }
        Returns: undefined
      }
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
      decide_integration_execution: {
        Args: { p_approve: boolean; p_execution_id: string }
        Returns: Json
      }
      decline_commercial_proposal: {
        Args: { p_proposal_id: string }
        Returns: undefined
      }
      default_platform_provider_account: {
        Args: { p_provider_key: string }
        Returns: string
      }
      delete_ai_assistant: {
        Args: { p_id: string; p_organization_id: string }
        Returns: undefined
      }
      delete_ai_deployment: {
        Args: { p_id: string; p_organization_id: string }
        Returns: undefined
      }
      delete_resource_availability_exception: {
        Args: { p_id: string }
        Returns: undefined
      }
      delete_resource_requirement: {
        Args: { p_id: string }
        Returns: undefined
      }
      delete_secret_reference: {
        Args: { p_organization_id: string; p_secret_id: string }
        Returns: undefined
      }
      detach_plan_addon: {
        Args: { p_addon_plan_id: string; p_plan_id: string }
        Returns: undefined
      }
      disconnect_integration: {
        Args: { p_connection_id: string; p_organization_id: string }
        Returns: undefined
      }
      due_integration_resource_syncs: {
        Args: never
        Returns: {
          resource_id: string
        }[]
      }
      effective_retail_rates: {
        Args: { p_at?: string; p_currency: string; p_organization_id: string }
        Returns: {
          currency: string
          meter_id: string
          unit_amount_micros: number
        }[]
      }
      email_domain_provider_account: {
        Args: { p_organization_id: string }
        Returns: string
      }
      email_receiving_account: {
        Args: { p_to_addresses: string[] }
        Returns: {
          provider_account_id: string
          state: string
        }[]
      }
      email_sender_account: {
        Args: { p_email_identity_id: string; p_organization_id: string }
        Returns: {
          detail: string
          provider_account_id: string
          provider_key: string
          state: string
        }[]
      }
      email_test_send_account: {
        Args: { p_id: string; p_organization_id: string }
        Returns: {
          detail: string
          provider_account_id: string
          provider_key: string
          state: string
        }[]
      }
      end_client_tenant_relationship: {
        Args: { p_organization_id: string; p_relationship_id: string }
        Returns: undefined
      }
      end_support_session: { Args: { p_id: string }; Returns: undefined }
      engagement_deliverable_summaries: {
        Args: { p_engagement_id: string; p_organization_id: string }
        Returns: {
          artifact_id: string
          artifact_status: string
          available: boolean
          id: string
          kind: string
          label: string
          tenant_organization_id: string
        }[]
      }
      existing_client_tenant_options: {
        Args: {
          p_customer_id: string
          p_organization_id: string
          p_search?: string
        }
        Returns: {
          id: string
          name: string
        }[]
      }
      external_card_payment_availability: {
        Args: { p_invoice_id: string; p_provider: string }
        Returns: {
          account_id: string
          currency: string
          outstanding_minor: number
        }[]
      }
      fail_call_attempt: {
        Args: { p_call_id: string; p_organization_id: string }
        Returns: undefined
      }
      finalize_organization_charges: {
        Args: {
          p_billing_period_end: string
          p_billing_period_start: string
          p_organization_id: string
        }
        Returns: number
      }
      finance_dashboard_summary: {
        Args: { p_from: string; p_organization_id: string; p_to: string }
        Returns: Json
      }
      finish_customer_notification: {
        Args: {
          p_external_id?: string
          p_job_id: string
          p_lease_id: string
          p_outcome: string
        }
        Returns: boolean
      }
      finish_email_test_send: {
        Args: {
          p_detail?: string
          p_external_id?: string
          p_id: string
          p_organization_id: string
          p_outcome: string
        }
        Returns: undefined
      }
      finish_integration_action: {
        Args: {
          p_detail?: string
          p_id: string
          p_outcome: string
          p_retry?: boolean
        }
        Returns: undefined
      }
      finish_message_delivery: {
        Args: {
          p_detail?: string
          p_external_id?: string
          p_id: string
          p_outcome: string
        }
        Returns: undefined
      }
      form_editor_state: {
        Args: { p_form_id: string; p_organization_id: string }
        Returns: Json
      }
      form_submission_customer_candidates: {
        Args: { p_organization_id: string; p_submission_id: string }
        Returns: Json
      }
      grant_integration_tool: {
        Args: {
          p_assistant_id: string
          p_automation_rule_id: string
          p_capability_key: string
          p_connection_id: string
          p_mcp_tool_id: string
          p_organization_id: string
          p_requires_approval?: boolean
          p_resource_id?: string
        }
        Returns: string
      }
      grant_plan_module: {
        Args: { p_module_id: string; p_plan_id: string }
        Returns: undefined
      }
      grant_plan_product: {
        Args: { p_plan_id: string; p_product_key: string }
        Returns: undefined
      }
      granted_tools_for_assistant: {
        Args: { p_assistant_id: string; p_organization_id: string }
        Returns: {
          capability_key: string
          connection_id: string
          connector_key: string
          grant_id: string
          mcp_description: string
          mcp_input_schema: Json
          mcp_tool_name: string
          requires_approval: boolean
          resource_external_id: string
          resource_id: string
          resource_type: string
          target_kind: string
        }[]
      }
      granted_tools_for_automation: {
        Args: { p_rule_id: string }
        Returns: {
          capability_key: string
          connection_id: string
          connector_key: string
          grant_id: string
          mcp_description: string
          mcp_input_schema: Json
          mcp_tool_name: string
          requires_approval: boolean
          resource_external_id: string
          resource_id: string
          resource_type: string
          target_kind: string
        }[]
      }
      hand_off_accepted_proposal: {
        Args: { p_proposal_id: string }
        Returns: string
      }
      handle_website_conversation: {
        Args: {
          p_action: string
          p_body?: string
          p_organization_id: string
          p_thread_id: string
        }
        Returns: undefined
      }
      home_financial_totals: {
        Args: { p_from: string; p_organization_id: string; p_to: string }
        Returns: {
          currency: string
          incurred_minor: number
          invoiced_minor: number
          margin_minor: number
        }[]
      }
      home_studio_summary: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      hostname_binding: {
        Args: { p_hostname: string }
        Returns: {
          organization_id: string
          surface: string
        }[]
      }
      import_pipeline_version: { Args: never; Returns: number }
      inbound_voice_agent_state: {
        Args: { p_account_sid: string; p_external_id: string }
        Returns: string
      }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          business_name: string
          email: string
          expires_at: string
          role_name: string
          state: string
        }[]
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
      library_file_page: {
        Args: {
          p_limit?: number
          p_mime_types?: string[]
          p_offset?: number
          p_organization_id: string
          p_search?: string
          p_sort?: string
          p_usage?: string
        }
        Returns: {
          content_sha256: string
          created_at: string
          file_name: string
          id: string
          link_count: number
          mime_type: string
          size_bytes: number
          total_count: number
        }[]
      }
      library_file_summary: {
        Args: { p_organization_id: string }
        Returns: {
          file_count: number
          total_bytes: number
          unused_count: number
        }[]
      }
      link_call_customer: {
        Args: {
          p_call_id: string
          p_customer_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      link_conversation_customer: {
        Args: {
          p_conversation_id: string
          p_customer_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      link_customer_location: {
        Args: {
          p_customer_id: string
          p_location_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      link_existing_client_tenant: {
        Args: {
          p_authority_basis: string
          p_customer_id: string
          p_organization_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      link_form_submission_customer: {
        Args: {
          p_customer_id: string
          p_organization_id: string
          p_submission_id: string
        }
        Returns: undefined
      }
      list_form_submission_page: {
        Args: {
          p_form_id: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
        }
        Returns: Json
      }
      list_form_submissions: {
        Args: { p_form_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      list_form_templates: { Args: never; Returns: Json }
      list_forms: { Args: { p_organization_id: string }; Returns: Json }
      list_page_templates: { Args: never; Returns: Json }
      list_section_patterns: { Args: never; Returns: Json }
      list_site_templates: { Args: never; Returns: Json }
      mark_voice_agent_uncertain: {
        Args: { p_call_id: string }
        Returns: undefined
      }
      marketing_command: {
        Args: { p_command: string; p_input: Json; p_organization_id: string }
        Returns: string
      }
      marketing_read: {
        Args: { p_filters?: Json; p_organization_id: string; p_view: string }
        Returns: Json
      }
      member_display_names: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string
          membership_id: string
        }[]
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
      opportunity_stage_summary: {
        Args: { p_organization_id: string }
        Returns: {
          currency: string
          opportunity_count: number
          stage_id: string
          stage_kind: string
          stage_name: string
          stage_position: number
          value_minor: string
        }[]
      }
      organization_allowance_state: {
        Args: {
          p_allowance_key?: string
          p_at?: string
          p_organization_id: string
        }
        Returns: {
          allowance_key: string
          allowance_type: string
          configuration_error: string
          consumed: number
          contributions: Json
          enforcement: string
          hard_limit: number
          included: number
          label: string
          meter_id: string
          overage_behavior: string
          overage_policy: string
          overage_quantity: number
          period: string
          remaining: number
          reserved: number
          reset_semantics: string
          service_class: string
          state: string
          unit: string
          window_basis: string
          window_ends_at: string
          window_starts_at: string
        }[]
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
          uncosted_quantity: number
          unpriced_quantity: number
        }[]
      }
      organization_cost_to_serve: {
        Args: {
          p_organization_id: string
          p_period_end: string
          p_period_start: string
          p_reporting_currency?: string
        }
        Returns: {
          attributable_has_unallocated_peer: boolean
          attributable_known_cogs_micros: number
          component_count: number
          cost_coverage: number
          direct_usage_cogs_micros: number
          direct_usage_has_unknown: boolean
          infrastructure_attributable_cogs_micros: number
          known_component_count: number
          manual_direct_cogs_micros: number
          reporting_currency: string
          resource_cogs_micros: number
          shared_platform_cost_micros: number
          unallocated_cost_micros: number
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
      organization_email_sender_status: {
        Args: { p_organization_id: string }
        Returns: {
          address: string
          detail: string
          email_identity_id: string
          state: string
        }[]
      }
      organization_email_senders: {
        Args: { p_organization_id: string }
        Returns: {
          address: string
          can_take_replies: boolean
          detail: string
          display_name: string
          email_identity_id: string
          is_default: boolean
          is_reply_to: boolean
          receives_in_inbox: boolean
          state: string
        }[]
      }
      organization_integration_connections: {
        Args: { p_organization_id: string }
        Returns: {
          account_label: string
          connector_key: string
          connector_name: string
          created_at: string
          has_credential: boolean
          id: string
          last_verified_at: string
          resource_count: number
          scopes: string[]
          status: string
        }[]
      }
      organization_launch_blockers: {
        Args: { p_id: string }
        Returns: string[]
      }
      organization_module_entitled: {
        Args: { p_module_key: string; p_organization_id: string }
        Returns: boolean
      }
      organization_open_now: {
        Args: { p_at?: string; p_organization_id: string }
        Returns: boolean
      }
      organization_plan_agreement_provider_price_reference: {
        Args: {
          p_agreement_id: string
          p_billing_interval: string
          p_environment: string
          p_organization_id: string
        }
        Returns: string
      }
      organization_plan_price:
        | {
            Args: {
              p_at?: string
              p_organization_id: string
              p_plan_id: string
            }
            Returns: {
              amount_minor: number
              currency: string
              source: string
              source_id: string
            }[]
          }
        | {
            Args: {
              p_at: string
              p_billing_interval: string
              p_organization_id: string
              p_plan_id: string
            }
            Returns: {
              amount_minor: number
              currency: string
              source: string
              source_id: string
            }[]
          }
      organization_revenue_summary: {
        Args: {
          p_billing_period_end: string
          p_billing_period_start: string
          p_organization_id: string
          p_reporting_currency?: string
        }
        Returns: {
          addon_minor: number
          base_plan_minor: number
          cost_coverage: number
          credit_adjustment_minor: number
          customer_obligation_minor: number
          debit_adjustment_minor: number
          has_mixed_currency: boolean
          known_contribution_minor: number
          known_cost_to_serve_minor: number
          known_margin: number
          one_time_service_minor: number
          recurring_resource_minor: number
          reporting_currency: string
          usage_overage_minor: number
        }[]
      }
      organization_usage_detail: {
        Args: { p_organization_id: string }
        Returns: {
          allowance_consumed_before: number
          allowance_included_applied: number
          allowance_included_total: number
          allowance_key: string
          allowance_overage_quantity: number
          allowance_state: string
          allowance_window_basis: string
          allowance_window_end: string
          allowance_window_start: string
          awaiting_reconciliation: boolean
          customer_charge_micros: number
          customer_currency: string
          estimated_cost_micros: number
          estimated_currency: string
          fulfilled_through: string
          meter_id: string
          occurred_at: string
          provider_key: string
          provider_state: string
          quantity: number
          reconciled_at: string
          reconciled_cost_micros: number
          reconciled_currency: string
          retail_state: string
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
      plan_entitled_features_bulk: {
        Args: { p_plan_ids: string[] }
        Returns: {
          feature_id: string
          plan_id: string
        }[]
      }
      plan_price_provider_reference: {
        Args: {
          p_environment: string
          p_organization_id: string
          p_plan_price_id: string
        }
        Returns: string
      }
      platform_ai_runtime_assignment_overview: {
        Args: never
        Returns: {
          capability: string
          model: string
          provider_account_id: string
          provider_account_label: string
          provider_key: string
          provider_service_id: string
          provider_service_key: string
          provider_service_label: string
          updated_at: string
        }[]
      }
      platform_connector_usage: {
        Args: never
        Returns: {
          active_connections: number
          attention_connections: number
          connector_key: string
          organizations: number
        }[]
      }
      platform_email_readiness_facts: {
        Args: never
        Returns: {
          account_id: string
          account_status: string
          credential_set: boolean
          last_accepted_at: string
          last_delivered_at: string
          last_failed_at: string
          last_failure: string
        }[]
      }
      platform_health_summary: {
        Args: { p_recent_limit?: number }
        Returns: Json
      }
      platform_meter_observations: {
        Args: never
        Returns: {
          meter_id: string
          usage_event_count: number
        }[]
      }
      platform_provider_organization_overview: {
        Args: { p_organization_id?: string; p_provider_key: string }
        Returns: {
          binding_id: string
          binding_status: string
          bound_at: string
          external_account_id: string
          last_error: string
          last_reconciled_at: string
          last_verified_at: string
          organization_id: string
          organization_name: string
          provider_account_id: string
          reconciliation_detail: string
          reconciliation_state: string
          resource_count: number
        }[]
      }
      platform_public_domain: { Args: never; Returns: string }
      platform_revenue_portfolio: {
        Args: {
          p_billing_period_end: string
          p_billing_period_start: string
          p_reporting_currency?: string
        }
        Returns: {
          cost_coverage: number
          customer_obligation_minor: number
          known_contribution_minor: number
          known_cost_to_serve_minor: number
          known_margin: number
          organization_id: string
          organization_name: string
        }[]
      }
      platform_usage_cost_components: {
        Args: { p_usage_event_id: string }
        Returns: {
          component_key: string
          cost_meter_key: string
          cost_state: string
          effective_state: string
          id: string
          native_cost_micros: number
          native_currency: string
          provider_key: string
          provider_rate_id: string
          quantity: number
          reporting_cost_micros: number
          reporting_currency: string
          unit: string
          unknown_reason: string
        }[]
      }
      platform_usage_economics: {
        Args: {
          p_cost_state?: string
          p_from?: string
          p_meter_id?: string
          p_organization_id?: string
          p_provider_key?: string
          p_to?: string
        }
        Returns: {
          allowance_included_applied: number
          allowance_included_total: number
          allowance_key: string
          allowance_overage_quantity: number
          allowance_state: string
          allowance_window_basis: string
          allowance_window_end: string
          allowance_window_start: string
          component_count: number
          cost_state: string
          customer_charge_micros: number
          customer_currency: string
          known_cost_micros: number
          meter_id: string
          occurred_at: string
          organization_id: string
          organization_name: string
          quantity: number
          reporting_currency: string
          retail_rate_id: string
          retail_state: string
          source_domain: string
          source_record_id: string
          usage_event_id: string
        }[]
      }
      portal_context: {
        Args: never
        Returns: {
          customer_id: string
          expires_at: string
          organization_id: string
          portal_invite_id: string
        }[]
      }
      portal_context_at_hostname: {
        Args: { p_hostname: string }
        Returns: {
          customer_id: string
          expires_at: string
          organization_id: string
          portal_invite_id: string
        }[]
      }
      portal_forms_available: { Args: never; Returns: Json }
      portal_module_availability: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      portal_notification_preferences: { Args: never; Returns: Json }
      portal_published_composition: { Args: never; Returns: Json }
      portal_service_disclosures: {
        Args: { p_disclosure_id?: string; p_limit?: number }
        Returns: Json
      }
      portal_service_reviews: {
        Args: { p_disclosure_id: string }
        Returns: Json
      }
      proposal_context: {
        Args: never
        Returns: {
          customer_id: string
          expires_at: string
          organization_id: string
          proposal_invite_id: string
        }[]
      }
      propose_notification_recipient: {
        Args: { p_email_address: string; p_purposes: string[] }
        Returns: string
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
      public_communication_history: {
        Args: { p_site_id: string; p_visitor_key: string }
        Returns: Json
      }
      public_plan_catalog: {
        Args: never
        Returns: {
          description: string
          kind: string
          label: string
          plan_key: string
          prices: Json
          products: Json
          quotas: Json
          requires_contact_sales: boolean
        }[]
      }
      public_site_editor_state: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      public_site_preview: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: Json
      }
      publish_ai_assistant: {
        Args: {
          p_expected_draft: number
          p_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: string
      }
      publish_form_revision: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: undefined
      }
      publish_portal_draft: {
        Args: { p_expected_version: number; p_organization_id: string }
        Returns: string
      }
      publish_public_site_revision: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: undefined
      }
      publish_service_disclosure: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_organization_id: string
        }
        Returns: string
      }
      publish_service_disclosure_notification: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_notify?: boolean
          p_organization_id: string
        }
        Returns: string
      }
      published_connectors: {
        Args: never
        Returns: {
          apps: Json
          category: string
          icon_ref: string
          key: string
          marketing_description: string
          marketing_slug: string
          marketing_summary: string
          name: string
          status: string
          suite: string
        }[]
      }
      published_form: {
        Args: { p_form_slug: string; p_organization_slug: string }
        Returns: Json
      }
      published_form_by_key: { Args: { p_key: string }; Returns: Json }
      published_gold_homepage: { Args: never; Returns: Json }
      published_hostname_form: {
        Args: { p_form_slug: string; p_hostname: string }
        Returns: Json
      }
      published_hostname_site: { Args: { p_hostname: string }; Returns: Json }
      purge_integration_executions: {
        Args: { p_older_than?: string }
        Returns: number
      }
      queue_granted_integration_library_read: {
        Args: { p_arguments: Json; p_execution_id: string }
        Returns: string
      }
      queue_integration_library_read: {
        Args: {
          p_arguments: Json
          p_capability_key: string
          p_connection_id: string
        }
        Returns: string
      }
      queue_outbound_email: {
        Args: {
          p_attachments: Json
          p_conversation_id: string
          p_customer_id: string
          p_email_identity_id: string
          p_html: string
          p_idempotency_key: string
          p_organization_id: string
          p_subject: string
          p_text: string
          p_to: string
        }
        Returns: string
      }
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
      read_form_revision: {
        Args: {
          p_form_id: string
          p_organization_id: string
          p_revision_id: string
        }
        Returns: Json
      }
      read_integration_credential: {
        Args: { p_connection_id: string }
        Returns: {
          connector_key: string
          organization_id: string
          secret: string
          status: string
        }[]
      }
      read_provider_account_credential: {
        Args: { p_account_id: string }
        Returns: {
          credential_identifier: string
          credential_kind: string
          external_account_id: string
          provider_key: string
          secret: string
        }[]
      }
      record_agreement_provider_price: {
        Args: {
          p_agreement_id: string
          p_billing_interval: string
          p_environment: string
          p_price_reference: string
          p_product_reference: string
        }
        Returns: string
      }
      record_ai_runtime_assignment: {
        Args: {
          p_capability: string
          p_model: string
          p_provider_account_id: string
          p_provider_service_id: string
        }
        Returns: undefined
      }
      record_ai_usage: {
        Args: {
          p_capability: string
          p_input_tokens: number
          p_organization_id: string
          p_output_tokens: number
          p_provider_key: string
          p_reference: string
        }
        Returns: undefined
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
      record_call_leg: {
        Args: { p_conference_name: string; p_external_id: string }
        Returns: string
      }
      record_call_outcome: {
        Args: {
          p_call_id: string
          p_duration_seconds: number
          p_note: string
          p_organization_id: string
          p_outcome_id: string
        }
        Returns: Json
      }
      record_commercial_adjustment: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_direction: string
          p_effective_at?: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      record_commercial_retail_rate: {
        Args: {
          p_approval_state?: string
          p_billing_interval?: string
          p_currency: string
          p_effective_from: string
          p_effective_to?: string
          p_meter_id: string
          p_note?: string
          p_organization_id?: string
          p_plan_id?: string
          p_source: string
          p_unit_amount_micros: number
        }
        Returns: string
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
      record_custom_domain_registration: {
        Args: {
          p_configuration_state: string
          p_dns_records: Json
          p_domain_id: string
          p_error_code?: string
          p_error_message?: string
          p_organization_id: string
        }
        Returns: string
      }
      record_email_domain_provisioning: {
        Args: {
          p_dns_records?: Json
          p_error_code?: string
          p_error_message?: string
          p_organization_id: string
          p_provider_account_id?: string
          p_provider_domain_id?: string
          p_provider_status?: string
          p_resource_id: string
          p_status: string
        }
        Returns: undefined
      }
      record_email_event: {
        Args: {
          p_detail: string
          p_event_at?: string
          p_event_type: string
          p_payload: Json
          p_provider_event_id: string
          p_provider_message_id: string
        }
        Returns: string
      }
      record_email_send_result: {
        Args: {
          p_detail?: string
          p_external_id?: string
          p_message_id: string
          p_organization_id: string
          p_outcome: string
          p_rfc_message_id?: string
        }
        Returns: undefined
      }
      record_external_readings: {
        Args: { p_location_id: string; p_readings: Json }
        Returns: number
      }
      record_inbound_attachment_stored: {
        Args: {
          p_attachment_id: string
          p_rejection?: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: undefined
      }
      record_inbound_call: {
        Args: {
          p_external_id: string
          p_from_number: string
          p_payload: Json
          p_payload_hash: string
          p_to_number: string
        }
        Returns: string
      }
      record_inbound_email: {
        Args: {
          p_attachments: Json
          p_authentication: Json
          p_from_address: string
          p_html: string
          p_in_reply_to: string
          p_provider_email_id: string
          p_provider_event_id: string
          p_received_at: string
          p_references: string[]
          p_rfc_message_id: string
          p_subject: string
          p_text: string
          p_to_addresses: string[]
        }
        Returns: Json
      }
      record_inbound_message: {
        Args: {
          p_body: string
          p_external_id: string
          p_from_number: string
          p_to_number: string
        }
        Returns: string
      }
      record_infrastructure_cost: {
        Args: {
          p_allocation_quality: string
          p_billing_period: string
          p_cost_category: string
          p_driver_basis?: string
          p_driver_quantity?: number
          p_fx_rate?: number
          p_fx_rate_id?: string
          p_native_cost_micros: number
          p_native_currency: string
          p_note?: string
          p_organization_id?: string
          p_provider_account_id?: string
          p_provider_binding_id?: string
          p_provider_key?: string
          p_provider_reference?: string
          p_provider_resource_id?: string
          p_reporting_cost_micros?: number
          p_reporting_currency?: string
          p_source: string
        }
        Returns: string
      }
      record_integration_connection: {
        Args: {
          p_account_label: string
          p_connector_key: string
          p_organization_id: string
        }
        Returns: string
      }
      record_integration_health: {
        Args: {
          p_account_label?: string
          p_connection_id: string
          p_error?: string
          p_ok: boolean
          p_scopes?: string[]
        }
        Returns: undefined
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
      record_invitation_delivery: {
        Args: {
          p_detail?: string
          p_invitation_id: string
          p_organization_id: string
          p_payload_hash?: string
          p_provider_message_id?: string
          p_recipient: string
          p_state: string
        }
        Returns: string
      }
      record_invitation_delivery_event: {
        Args: {
          p_detail: string
          p_event_at?: string
          p_payload: Json
          p_payload_hash: string
          p_provider_message_id: string
          p_state: string
        }
        Returns: string
      }
      record_managed_integration_resource: {
        Args: {
          p_connection_id: string
          p_display_name: string
          p_external_id: string
          p_metadata?: Json
          p_resource_type: string
        }
        Returns: string
      }
      record_mcp_discovery: {
        Args: {
          p_error: string
          p_ok: boolean
          p_protocol_version: string
          p_server_id: string
          p_server_name: string
          p_tools: Json
        }
        Returns: number
      }
      record_message_delivery: {
        Args: { p_detail: string; p_id: string; p_sent: boolean }
        Returns: undefined
      }
      record_message_status: {
        Args: {
          p_external_id: string
          p_failure_reason?: string
          p_status: string
        }
        Returns: string
      }
      record_message_suppression: {
        Args: {
          p_external_number: string
          p_opted_out: boolean
          p_to_number: string
        }
        Returns: undefined
      }
      record_organization_email_domain: {
        Args: { p_domain: string; p_organization_id: string }
        Returns: string
      }
      record_organization_plan_agreement: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_effective_from: string
          p_effective_to?: string
          p_note?: string
          p_organization_id: string
          p_plan_id: string
        }
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
      record_phone_number_month: {
        Args: { p_billing_period: string; p_phone_number_id: string }
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
      record_plan_margin_policy: {
        Args: {
          p_currency: string
          p_effective_from: string
          p_hard_floor_margin: number
          p_note?: string
          p_plan_id: string
          p_source: string
          p_target_margin: number
          p_warning_margin: number
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
      record_plan_utilization_assumption: {
        Args: {
          p_allowance_key: string
          p_effective_from: string
          p_note?: string
          p_plan_id: string
          p_scenario: string
          p_source: string
          p_utilization: number
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
      record_provider_account: {
        Args: {
          p_account_id?: string
          p_credential_identifier: string
          p_credential_kind: string
          p_external_account_id: string
          p_label: string
          p_provider_key: string
        }
        Returns: string
      }
      record_provider_account_verification: {
        Args: {
          p_account_id: string
          p_error?: string
          p_metadata?: Json
          p_ok: boolean
        }
        Returns: undefined
      }
      record_provider_binding_reconciliation: {
        Args: {
          p_detail?: string
          p_organization_id: string
          p_provider_key: string
          p_state: string
        }
        Returns: undefined
      }
      record_provider_cost_rate: {
        Args: {
          p_commercial_meter_id: string
          p_cost_meter_key: string
          p_currency: string
          p_direction?: string
          p_effective_from: string
          p_effective_to?: string
          p_note?: string
          p_provider_account_id?: string
          p_provider_key: string
          p_region?: string
          p_resource_type?: string
          p_source: string
          p_unit_amount_micros: number
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
          p_effective_from?: string
          p_meter_id: string
          p_note?: string
          p_source: string
          p_source_url?: string
          p_unit_amount_micros: number
        }
        Returns: string
      }
      record_sms_send_result: {
        Args: {
          p_external_id?: string
          p_failure_reason?: string
          p_message_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: undefined
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
      record_voice_agent_event: {
        Args: {
          p_event_id: string
          p_external_id: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_seconds: number
          p_session_id: string
          p_type: string
        }
        Returns: Json
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
      refresh_inbound_routing: {
        Args: {
          p_account_sid: string
          p_external_id: string
          p_from_number: string
          p_to_number: string
        }
        Returns: Json
      }
      reissue_invitation: { Args: { p_id: string }; Returns: string }
      release_conversation: {
        Args: { p_conversation_id: string; p_organization_id: string }
        Returns: undefined
      }
      release_custom_domain: {
        Args: { p_domain_id: string; p_organization_id: string }
        Returns: undefined
      }
      release_organization_email_domain: {
        Args: { p_organization_id: string; p_resource_id: string }
        Returns: undefined
      }
      release_phone_number_assignment: {
        Args: { p_assignment_id: string; p_organization_id: string }
        Returns: undefined
      }
      release_service_review: {
        Args: {
          p_customer_id: string
          p_deliverable_id?: string
          p_engagement_id: string
          p_organization_id: string
          p_revision_id: string
        }
        Returns: string
      }
      release_service_review_notification: {
        Args: {
          p_customer_id: string
          p_deliverable_id?: string
          p_engagement_id: string
          p_notify?: boolean
          p_organization_id: string
          p_revision_id: string
        }
        Returns: string
      }
      remove_call_participant: {
        Args: { p_organization_id: string; p_participant_id: string }
        Returns: undefined
      }
      remove_connector_app_feature: {
        Args: { p_connector_app_id: string; p_feature_id: string }
        Returns: undefined
      }
      remove_operating_hours: { Args: { p_id: string }; Returns: undefined }
      remove_plan_quota: {
        Args: { p_allowance_key: string; p_plan_id: string }
        Returns: undefined
      }
      remove_platform_connector_app: {
        Args: { p_connector_key: string; p_key: string }
        Returns: undefined
      }
      remove_provider_service_feature: {
        Args: { p_feature_id: string; p_provider_service_id: string }
        Returns: undefined
      }
      remove_resource_capability: {
        Args: { p_capability_id: string; p_resource_id: string }
        Returns: undefined
      }
      remove_type_checklist_item: { Args: { p_id: string }; Returns: undefined }
      remove_work_item_priced_line: {
        Args: { p_id: string }
        Returns: undefined
      }
      rename_form: {
        Args: { p_form_id: string; p_name: string; p_organization_id: string }
        Returns: undefined
      }
      rename_resource_capability: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      rename_work_item_type: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      replace_integration_resources: {
        Args: { p_connection_id: string; p_resources: Json }
        Returns: undefined
      }
      request_public_communication_handoff: {
        Args: { p_site_id: string; p_visitor_key: string }
        Returns: string
      }
      resolve_ai_runtime_assignment: {
        Args: { p_capability: string }
        Returns: {
          model: string
          provider_account_id: string
          provider_key: string
          provider_service_key: string
        }[]
      }
      resolve_commercial_retail_rate: {
        Args: {
          p_at: string
          p_billing_interval?: string
          p_currency: string
          p_meter_id: string
          p_organization_id?: string
          p_plan_id?: string
        }
        Returns: {
          rate_id: string
          source: string
          source_scope: string
          unit_amount_micros: number
        }[]
      }
      resolve_operator_agent: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      resolve_operator_agent_turn: {
        Args: { p_conversation_id?: string; p_organization_id: string }
        Returns: Json
      }
      resolve_outbound_number: {
        Args: { p_organization_id: string; p_phone_number_id?: string }
        Returns: {
          e164: string
          phone_number_id: string
          source: string
        }[]
      }
      resolve_public_agent_turn: {
        Args: { p_deployment_id: string; p_visitor_key: string }
        Returns: Json
      }
      resolve_public_assistant: {
        Args: { p_deployment_id: string }
        Returns: {
          entitled: boolean
          instructions: string
          organization_id: string
        }[]
      }
      resolve_secret_reference: {
        Args: { p_key: string; p_organization_id: string }
        Returns: string
      }
      resource_availability_conflicts: {
        Args: { p_from: string; p_organization_id: string; p_to: string }
        Returns: {
          problem: string
          resource_id: string
          work_item_id: string
        }[]
      }
      resource_open_windows: {
        Args: { p_from: string; p_organization_id: string; p_to: string }
        Returns: {
          during: unknown
          resource_id: string
        }[]
      }
      respond_service_review: {
        Args: {
          p_decision: string
          p_description?: string
          p_expected_version: number
          p_review_id: string
        }
        Returns: undefined
      }
      retry_service_notification: {
        Args: { p_intent_id: string; p_organization_id: string }
        Returns: undefined
      }
      review_mcp_tool: {
        Args: {
          p_classification: string
          p_enabled: boolean
          p_organization_id: string
          p_tool_id: string
        }
        Returns: undefined
      }
      revoke_integration_tool_grant: {
        Args: { p_grant_id: string; p_organization_id: string }
        Returns: undefined
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
      rotate_secret_reference: {
        Args: {
          p_label?: string
          p_organization_id: string
          p_purpose?: string
          p_secret_id: string
          p_value: string
        }
        Returns: undefined
      }
      run_due_automations: { Args: never; Returns: number }
      save_ai_assistant: {
        Args: {
          p_configuration: Json
          p_expected_draft?: number
          p_id: string
          p_instructions: string
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      save_ai_deployment: {
        Args: {
          p_assistant_id: string
          p_configuration: Json
          p_display_name: string
          p_enabled: boolean
          p_greeting: string
          p_handoff: string
          p_id: string
          p_organization_id: string
          p_site_id: string
          p_surface: string
          p_version_id: string
        }
        Returns: string
      }
      save_business_profile: {
        Args: {
          p_labels: Json
          p_navigation: Json
          p_nouns: Json
          p_organization_id: string
          p_revision: number
        }
        Returns: number
      }
      save_commercial_draft_scenario: {
        Args: {
          p_addon_plan_ids?: string[]
          p_candidate_prices_minor: number[]
          p_currency: string
          p_direct_costs?: Json
          p_expected_resource_count: number
          p_expected_seats: number
          p_inputs?: Json
          p_name: string
          p_notes: string
          p_plan_id: string
          p_scenario_id: string
        }
        Returns: string
      }
      save_form_draft: {
        Args: {
          p_definition: Json
          p_organization_id: string
          p_revision_id: string
        }
        Returns: undefined
      }
      save_portal_draft: {
        Args: {
          p_content: Json
          p_expected_version: number
          p_organization_id: string
        }
        Returns: string
      }
      save_service_disclosure: {
        Args: {
          p_content: Json
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_organization_id: string
        }
        Returns: string
      }
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
          p_resource_ids: string[]
          p_starts_at: string
          p_work_item_id: string
        }
        Returns: undefined
      }
      service_deliverable_options: {
        Args: {
          p_engagement_id: string
          p_organization_id: string
          p_search?: string
        }
        Returns: {
          artifact_status: string
          id: string
          kind: string
          label: string
        }[]
      }
      service_notification_history: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      set_ai_knowledge: {
        Args: {
          p_assistant_id: string
          p_enabled: boolean
          p_organization_id: string
          p_site_id: string
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
      set_call_leg_provider_id: {
        Args: {
          p_external_id: string
          p_organization_id: string
          p_participant_id: string
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
      set_connector_app_feature: {
        Args: {
          p_connector_app_id: string
          p_feature_id: string
          p_note?: string
          p_relationship?: string
        }
        Returns: undefined
      }
      set_conversation_status: {
        Args: {
          p_conversation_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: undefined
      }
      set_custom_domain_verification: {
        Args: {
          p_configuration_state?: string
          p_dns_records?: Json
          p_domain_id: string
          p_error_code?: string
          p_error_message?: string
          p_organization_id: string
          p_ssl_state?: string
          p_verification_state: string
        }
        Returns: undefined
      }
      set_customer_notification_sender: {
        Args: {
          p_customer_id: string
          p_email_identity_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      set_default_email_sender: {
        Args: { p_email_identity_id: string; p_organization_id: string }
        Returns: undefined
      }
      set_default_provider_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      set_email_reply_to: {
        Args: { p_email_identity_id: string; p_organization_id: string }
        Returns: undefined
      }
      set_form_archived: {
        Args: {
          p_archived: boolean
          p_form_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      set_mcp_server_enabled: {
        Args: {
          p_enabled: boolean
          p_organization_id: string
          p_server_id: string
        }
        Returns: undefined
      }
      set_meter_cost_model_component: {
        Args: {
          p_component_key: string
          p_cost_meter_key: string
          p_direction?: string
          p_meter_id: string
          p_note?: string
          p_provider_key: string
          p_quantity_multiplier: number
          p_region?: string
          p_required?: boolean
          p_resource_type?: string
        }
        Returns: string
      }
      set_organization_identity: {
        Args: {
          p_address_line1: string
          p_address_line2: string
          p_city: string
          p_contact_email: string
          p_contact_phone: string
          p_country_code: string
          p_industry: string
          p_legal_name: string
          p_organization_id: string
          p_postal_code: string
          p_region: string
          p_website_url: string
        }
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
      set_participant_hold: {
        Args: {
          p_hold: boolean
          p_organization_id: string
          p_participant_id: string
        }
        Returns: undefined
      }
      set_participant_muted: {
        Args: {
          p_muted: boolean
          p_organization_id: string
          p_participant_id: string
        }
        Returns: undefined
      }
      set_plan_allowance: {
        Args: {
          p_allowance_key: string
          p_allowance_type: string
          p_display_order?: number
          p_hard_limit: number
          p_included_quantity: number
          p_label: string
          p_meter_id?: string
          p_overage_behavior: string
          p_period: string
          p_plan_id: string
          p_reset_semantics: string
          p_service_class?: string
          p_unit: string
        }
        Returns: string
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
      set_platform_connector_app: {
        Args: {
          p_connector_key: string
          p_description: string
          p_display_order: number
          p_docs_url?: string
          p_implementation_state?: string
          p_key: string
          p_name: string
          p_vendor_status?: string
        }
        Returns: undefined
      }
      set_portal_form: {
        Args: {
          p_enabled: boolean
          p_form_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      set_primary_custom_domain: {
        Args: { p_domain_id: string; p_organization_id: string }
        Returns: undefined
      }
      set_provider_account_status: {
        Args: { p_account_id: string; p_status: string }
        Returns: undefined
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
      set_provider_service_feature: {
        Args: {
          p_feature_id: string
          p_note?: string
          p_provider_service_id: string
          p_relationship?: string
        }
        Returns: undefined
      }
      set_resource_capability_archived: {
        Args: { p_archived: boolean; p_id: string }
        Returns: undefined
      }
      set_resource_class: {
        Args: { p_resource_class: string; p_resource_id: string }
        Returns: undefined
      }
      set_resource_membership: {
        Args: { p_membership_id: string; p_resource_id: string }
        Returns: undefined
      }
      set_resource_routing: {
        Args: {
          p_base_location_id: string
          p_resource_id: string
          p_travel_mode: string
        }
        Returns: undefined
      }
      set_resource_working_hours: {
        Args: { p_hours: Json; p_resource_id: string }
        Returns: undefined
      }
      set_secret_reference_status: {
        Args: {
          p_organization_id: string
          p_secret_id: string
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
      set_type_booking_intake: {
        Args: { p_form_id: string; p_type_id: string }
        Returns: undefined
      }
      set_type_booking_policy: {
        Args: {
          p_allow_same_day: boolean
          p_cadence_minutes: number
          p_cancel_cutoff_minutes: number
          p_cancellation_status_id: string
          p_horizon_days: number
          p_minimum_notice_minutes: number
          p_reschedule_cutoff_minutes: number
          p_type_id: string
        }
        Returns: undefined
      }
      set_user_phone_number_preference: {
        Args: { p_organization_id: string; p_phone_number_id: string }
        Returns: undefined
      }
      set_work_item_resources: {
        Args: { p_resource_ids: string[]; p_work_item_id: string }
        Returns: undefined
      }
      set_work_item_type_schedulable: {
        Args: { p_id: string; p_schedulable: boolean }
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
      store_integration_credential: {
        Args: { p_connection_id: string; p_secret: string }
        Returns: undefined
      }
      store_provider_account_credential: {
        Args: { p_account_id: string; p_secret: string }
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
      submit_marketing_form: {
        Args: {
          p_answers: Json
          p_public_key: string
          p_request_id: string
          p_revision_id: string
          p_source: string
          p_token: string
          p_utm: Json
        }
        Returns: string
      }
      submit_portal_draft: {
        Args: { p_expected_version: number; p_organization_id: string }
        Returns: undefined
      }
      submit_portal_form: {
        Args: { p_answers: Json; p_form_id: string; p_revision_id: string }
        Returns: string
      }
      submit_public_form_by_key: {
        Args: {
          p_answers: Json
          p_public_key: string
          p_revision_id: string
          p_source?: string
        }
        Returns: string
      }
      submit_public_inquiry: {
        Args: {
          p_business_name: string
          p_business_type: string
          p_context: string
          p_email: string
          p_kind: string
          p_name: string
          p_phone: string
          p_team_size: string
          p_topic: string
        }
        Returns: undefined
      }
      submit_public_site_revision: {
        Args: { p_organization_id: string; p_revision_id: string }
        Returns: undefined
      }
      support_command: {
        Args: { p_command: string; p_input: Json; p_organization_id: string }
        Returns: string
      }
      support_read: {
        Args: { p_filters?: Json; p_organization_id: string; p_view: string }
        Returns: Json
      }
      support_service_review: {
        Args: { p_case_id: string; p_organization_id: string }
        Returns: Json
      }
      swap_integration_credential: {
        Args: {
          p_connection_id: string
          p_expected_refresh: string
          p_secret: string
        }
        Returns: boolean
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
      take_integration_results: {
        Args: { p_conversation_id: string; p_organization_id: string }
        Returns: {
          error_class: string
          execution_id: string
          result: Json
          status: string
          tool_label: string
        }[]
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
      transition_service_engagement: {
        Args: {
          p_engagement_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: undefined
      }
      unpublish_portal: {
        Args: { p_expected_version: number; p_organization_id: string }
        Returns: undefined
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
      update_public_site_draft: {
        Args: {
          p_navigation: Json
          p_organization_id: string
          p_pages: Json
          p_revision_id: string
        }
        Returns: undefined
      }
      update_resource_availability_exception: {
        Args: {
          p_ends_at: string
          p_id: string
          p_reason: string
          p_starts_at: string
        }
        Returns: undefined
      }
      update_resource_requirement: {
        Args: {
          p_capability_ids: string[]
          p_id: string
          p_quantity: number
          p_resource_class: string
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
      upsert_mcp_server: {
        Args: {
          p_connection_id: string
          p_endpoint: string
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      upsert_platform_connector: {
        Args: {
          p_auth_method: string
          p_capabilities: string[]
          p_category: string
          p_connection_method: string
          p_description: string
          p_display_order: number
          p_icon_ref: string
          p_is_public: boolean
          p_key: string
          p_marketing_description: string
          p_marketing_slug: string
          p_marketing_summary: string
          p_name: string
          p_status: string
          p_suite: string
        }
        Returns: string
      }
      upsert_platform_provider_service: {
        Args: {
          p_auth_mode: string
          p_description: string
          p_display_order: number
          p_docs_url: string
          p_family: string
          p_implementation_state: string
          p_key: string
          p_kind: string
          p_label: string
          p_metadata: Json
          p_provider_key: string
          p_vendor_status: string
        }
        Returns: string
      }
      usable_modules: { Args: { p_organization_id: string }; Returns: string[] }
      use_organization_hours: {
        Args: { p_resource_id: string }
        Returns: undefined
      }
      voice_agent_session_context: {
        Args: { p_session_id: string }
        Returns: Json
      }
      voice_agent_session_overview: { Args: never; Returns: Json }
      withdraw_notification_consent: { Args: never; Returns: undefined }
      withdraw_service_disclosure: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_organization_id: string
        }
        Returns: undefined
      }
      withdraw_service_review: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_organization_id: string
          p_review_id: string
        }
        Returns: undefined
      }
      withdraw_service_review_notification: {
        Args: {
          p_customer_id: string
          p_engagement_id: string
          p_expected_version: number
          p_notify?: boolean
          p_organization_id: string
          p_review_id: string
        }
        Returns: undefined
      }
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
      work_item_intake: {
        Args: { p_organization_id: string; p_work_item_id: string }
        Returns: Json
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
      [_ in never]: never
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
    Enums: {},
  },
} as const

