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
      field_definitions: {
        Row: {
          created_at: string
          created_by: string
          entity_type: string
          id: string
          key: string
          kind: string
          label: string
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
      organizations: {
        Row: {
          buffer_minutes: number
          created_at: string
          created_by: string
          currency: string
          id: string
          name: string
          slug: string | null
          timezone: string
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          name: string
          slug?: string | null
          timezone?: string
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          name?: string
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
      assign_role: {
        Args: { p_membership_id: string; p_role_id: string }
        Returns: undefined
      }
      booking_organization: { Args: { p_slug: string }; Returns: string }
      change_work_item_status: {
        Args: { p_status_id: string; p_work_item_id: string }
        Returns: undefined
      }
      claim_portal_invite: { Args: { p_token: string }; Returns: string }
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
          p_currency: string
          p_display_name: string
          p_name: string
          p_role: string
          p_timezone: string
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
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      customers_not_contacted: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: {
          customer_id: string
          days_since: number
          email: string
          last_activity: string
          name: string
          phone: string
        }[]
      }
      issue_invoice: {
        Args: { p_due_at: string; p_work_item_id: string }
        Returns: string
      }
      link_customer_location: {
        Args: {
          p_customer_id: string
          p_location_id: string
          p_organization_id: string
        }
        Returns: undefined
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
      record_external_readings: {
        Args: { p_location_id: string; p_readings: Json }
        Returns: number
      }
      record_message_delivery: {
        Args: { p_detail: string; p_id: string; p_sent: boolean }
        Returns: undefined
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
      record_provider_payment: {
        Args: {
          p_amount_minor: number
          p_provider: string
          p_provider_reference: string
          p_request_id: string
        }
        Returns: string
      }
      record_work_item_cost: {
        Args: {
          p_amount_minor: number
          p_description: string
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
      remove_operating_hours: { Args: { p_id: string }; Returns: undefined }
      remove_type_checklist_item: { Args: { p_id: string }; Returns: undefined }
      remove_work_item_priced_line: {
        Args: { p_id: string }
        Returns: undefined
      }
      rename_work_item_type: {
        Args: { p_id: string; p_name: string }
        Returns: undefined
      }
      run_due_automations: { Args: never; Returns: number }
      schedule_work_item: {
        Args: {
          p_ends_at: string
          p_resource_id: string
          p_starts_at: string
          p_work_item_id: string
        }
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
      set_type_bookable: {
        Args: {
          p_duration_minutes: number
          p_id: string
          p_price_item_id: string
          p_status_id: string
        }
        Returns: undefined
      }
      unschedule_work_item: {
        Args: { p_work_item_id: string }
        Returns: undefined
      }
      update_field_definition: {
        Args: {
          p_id: string
          p_label: string
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
      update_price_book_item: {
        Args: {
          p_id: string
          p_name: string
          p_unit: string
          p_unit_amount_minor: number
        }
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
          p_name: string
          p_position: number
          p_releases_resource: boolean
        }
        Returns: undefined
      }
      work_at_risk: {
        Args: { p_organization_id: string }
        Returns: {
          customer: string
          reason: string
          resource: string
          scheduled_from: string
          scheduled_to: string
          status: string
          title: string
          work_item_id: string
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

