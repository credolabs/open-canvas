import { useToast } from "@/hooks/use-toast";
import { Assistant } from "@langchain/langgraph-sdk";
import { ContextDocument } from "@opencanvas/shared/types";
import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useContext,
  useState,
} from "react";
import { createClient } from "@/hooks/utils";
import { getCookie, removeCookie } from "@/lib/cookies";
import { ASSISTANT_ID_COOKIE } from "@/constants";

type AssistantContentType = {
  assistants: Assistant[];
  selectedAssistant: Assistant | undefined;
  isLoadingAllAssistants: boolean;
  isDeletingAssistant: boolean;
  isCreatingAssistant: boolean;
  isEditingAssistant: boolean;
  getOrCreateAssistant: (userId: string) => Promise<void>;
  getAssistants: (userId: string) => Promise<void>;
  deleteAssistant: (assistantId: string) => Promise<boolean>;
  createCustomAssistant: (
    args: CreateCustomAssistantArgs
  ) => Promise<Assistant | undefined>;
  editCustomAssistant: (
    args: EditCustomAssistantArgs
  ) => Promise<Assistant | undefined>;
  setSelectedAssistant: Dispatch<SetStateAction<Assistant | undefined>>;
};

export type AssistantTool = {
  /**
   * The name of the tool
   */
  name: string;
  /**
   * The tool's description.
   */
  description: string;
  /**
   * JSON Schema for the parameters of the tool.
   */
  parameters: Record<string, any>;
};

export interface CreateAssistantFields {
  iconData?: {
    /**
     * The name of the Lucide icon to use for the assistant.
     * @default "User"
     */
    iconName: string;
    /**
     * The hex color code to use for the icon.
     */
    iconColor: string;
  };
  /**
   * The name of the assistant.
   */
  name: string;
  /**
   * An optional description of the assistant, provided by the user/
   */
  description?: string;
  /**
   * The tools the assistant has access to.
   */
  tools?: Array<AssistantTool>;
  /**
   * An optional system prompt to prefix all generations with.
   */
  systemPrompt?: string;
  is_default?: boolean;
  /**
   * The documents to include in the LLMs context.
   */
  documents?: ContextDocument[];
}

export type CreateCustomAssistantArgs = {
  newAssistant: CreateAssistantFields;
  userId: string;
  successCallback?: (id: string) => void;
};

export type EditCustomAssistantArgs = {
  editedAssistant: CreateAssistantFields;
  assistantId: string;
  userId: string;
};

const AssistantContext = createContext<AssistantContentType | undefined>(
  undefined
);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [isLoadingAllAssistants, setIsLoadingAllAssistants] = useState(false);
  const [isDeletingAssistant, setIsDeletingAssistant] = useState(false);
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false);
  const [isEditingAssistant, setIsEditingAssistant] = useState(false);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant>();

  const getAssistants = async (userId: string): Promise<void> => {
    setIsLoadingAllAssistants(true);
    try {
      const client = createClient();
      const response = await client.assistants.search({
        metadata: {
          user_id: userId,
        },
      });

      setAssistants({
        ...response,
      });
      setIsLoadingAllAssistants(false);
    } catch (e) {
      toast({
        title: "Failed to get assistants",
        description: "Please try again later.",
      });
      console.error("Failed to get assistants", e);
      setIsLoadingAllAssistants(false);
    }
  };

  const deleteAssistant = async (assistantId: string): Promise<boolean> => {
    setIsDeletingAssistant(true);
    try {
      const client = createClient();
      await client.assistants.delete(assistantId);

      if (selectedAssistant?.assistant_id === assistantId) {
        // Get the first assistant in the list to set as
        const defaultAssistant =
          assistants.find((a) => a.metadata?.is_default) || assistants[0];
        setSelectedAssistant(defaultAssistant);
      }

      setAssistants((prev) =>
        prev.filter((assistant) => assistant.assistant_id !== assistantId)
      );
      setIsDeletingAssistant(false);
      return true;
    } catch (e) {
      toast({
        title: "Failed to delete assistant",
        description: "Please try again later.",
      });
      console.error("Failed to delete assistant", e);
      setIsDeletingAssistant(false);
      return false;
    }
  };

  const createCustomAssistant = async ({
    newAssistant,
    userId,
    successCallback,
  }: CreateCustomAssistantArgs): Promise<Assistant | undefined> => {
    setIsCreatingAssistant(true);
    try {
      const client = createClient();
      const { tools, systemPrompt, name, documents, ...metadata } =
        newAssistant;
      const createdAssistant = await client.assistants.create({
        graphId: "agent",
        name,
        metadata: {
          user_id: userId,
          ...metadata,
        },
        config: {
          configurable: {
            tools,
            systemPrompt,
            documents,
          },
        },
        ifExists: "do_nothing",
      });

      setAssistants((prev) => [...prev, createdAssistant]);
      setSelectedAssistant(createdAssistant);
      successCallback?.(createdAssistant.assistant_id);
      setIsCreatingAssistant(false);
      return createdAssistant;
    } catch (e) {
      toast({
        title: "Failed to create assistant",
        description: "Please try again later.",
      });
      setIsCreatingAssistant(false);
      console.error("Failed to create an assistant", e);
      return undefined;
    }
  };

  const editCustomAssistant = async ({
    editedAssistant,
    assistantId,
    userId,
  }: EditCustomAssistantArgs): Promise<Assistant | undefined> => {
    setIsEditingAssistant(true);
    try {
      const client = createClient();
      const { tools, systemPrompt, name, documents, ...metadata } =
        editedAssistant;
      const response = await client.assistants.update(assistantId, {
        name,
        graphId: "agent",
        metadata: {
          user_id: userId,
          ...metadata,
        },
        config: {
          configurable: {
            tools,
            systemPrompt,
            documents,
          },
        },
      });

      setAssistants((prev) =>
        prev.map((assistant) => {
          if (assistant.assistant_id === assistantId) {
            return response;
          }
          return assistant;
        })
      );
      setIsEditingAssistant(false);
      return response;
    } catch (e) {
      console.error("Failed to edit assistant", e);
      setIsEditingAssistant(false);
      return undefined;
    }
  };

  /**
   * Legacy function which gets the assistant and updates it's metadata. Then, it deletes the assistant ID cookie
   * to ensure this function does not run again.
   */
  const legacyGetAndUpdateAssistant = async (
    userId: string,
    assistantIdCookie: string
  ) => {
    const updatedAssistant = await editCustomAssistant({
      editedAssistant: {
        is_default: true,
        iconData: {
          iconName: "User",
          iconColor: "#000000",
        },
        description: "Your default assistant.",
        name: "Default assistant",
        tools: undefined,
        systemPrompt: undefined,
      },
      assistantId: assistantIdCookie,
      userId,
    });

    if (!updatedAssistant) {
      const ghIssueTitle = "Failed to set default assistant";
      const ghIssueBody = `Failed to set the default assistant for user.\n\nDate: '${new Date().toISOString()}'`;
      const assignee = "bracesproul";
      const queryParams = new URLSearchParams({
        title: ghIssueTitle,
        body: ghIssueBody,
        assignee,
        "labels[]": "autogenerated",
      });
      const newIssueURL = `https://github.com/langchain-ai/open-canvas/issues/new?${queryParams.toString()}`;

      toast({
        title: "Failed to edit assistant",
        description: (
          <p>
            Please open an issue{" "}
            <a href={newIssueURL} target="_blank">
              here
            </a>{" "}
            (do <i>not</i> edit fields) and try again later.
          </p>
        ),
      });
      return;
    }

    setSelectedAssistant(updatedAssistant);
    setAssistants([updatedAssistant]);
    // Remove the cookie to ensure this is not called again.
    removeCookie(ASSISTANT_ID_COOKIE);
  };

  const getOrCreateAssistant = async (userId: string) => {
    if (selectedAssistant) {
      return;
    }
    setIsLoadingAllAssistants(true);
    const client = createClient();
    let userAssistants: Assistant[] = [];

    const assistantIdCookie = getCookie(ASSISTANT_ID_COOKIE);
    if (assistantIdCookie) {
      await legacyGetAndUpdateAssistant(userId, assistantIdCookie);
      // Return early because this function will set the selected assistant and assistants state.
      setIsLoadingAllAssistants(false);
      return;
    }

    // No cookie found. First, search for all assistants under the user's ID
    try {
      userAssistants = await client.assistants.search({
        graphId: "agent",
        metadata: {
          user_id: userId,
        },
        limit: 100,
      });
    } catch (e) {
      console.error("Failed to get default assistant", e);
    }

    // Delete all existing assistants
    for (const assistant of userAssistants) {
      try {
        await deleteAssistant(assistant.assistant_id);
      } catch (e) {
        console.error("Failed to delete assistant", e);
      }
    }

    if (!userAssistants.length) {
      // No assistants found, create predefined assistants including default and medical SOAP notes assistant.
      
      // Create default assistant
      await createCustomAssistant({
        newAssistant: {
          iconData: {
            iconName: "User",
            iconColor: "#000000",
          },
          name: "Default assistant",
          description: "Your default assistant.",
          is_default: true,
        },
        userId,
      });

      // Create medical SOAP notes assistant
      await createCustomAssistant({
        newAssistant: {
          iconData: {
            iconName: "Stethoscope",
            iconColor: "#059669", // Medical green color
          },
          name: "SOAP Notes Agent",
          description: "Specialized assistant for creating medical record summaries in SOAP note format.",
          systemPrompt: `You are a medical documentation specialist with expertise in creating comprehensive SOAP notes (Subjective, Objective, Assessment, Plan). When creating medical record summaries, follow these guidelines:

            SOAP Note Structure:
            - **Subjective**: Patient's reported symptoms, concerns, and history in their own words
            - **Objective**: Observable, measurable findings including vital signs, physical exam results, and diagnostic test results
            - **Assessment**: Clinical interpretation, differential diagnoses, and clinical reasoning
            - **Plan**: Treatment recommendations, follow-up instructions, and patient education

            Key Requirements:
            - Use clear, professional medical terminology
            - Maintain patient confidentiality (use placeholder names/identifiers)
            - Include relevant medical history and current medications when provided
            - Structure information logically and chronologically
            - Highlight critical findings and urgent concerns
            - Ensure documentation supports medical decision-making
            - Follow standard medical abbreviations and formatting

            Always prioritize accuracy, clarity, and completeness in medical documentation while maintaining professional standards.`,
        },
        userId,
      });

      // Create medication extraction assistant
      await createCustomAssistant({
        newAssistant: {
          iconData: {
            iconName: "Pill",
            iconColor: "#dc2626", // Medical red color
          },
          name: "Medication Agent",
          description: "Specialized assistant for identifying, extracting, and analyzing medications from medical records.",
          systemPrompt: `You are a clinical pharmacist and medication specialist with expertise in identifying, extracting, and analyzing medications from medical records. Your primary focus is to help healthcare professionals systematically review and organize medication information.

Core Responsibilities:
- **Medication Identification**: Extract all medications mentioned in medical records, including brand names, generic names, and common abbreviations
- **Dosage Analysis**: Identify dosages, frequencies, routes of administration, and duration of therapy
- **Medication Reconciliation**: Compare current medications with previous records to identify changes, additions, or discontinuations
- **Drug Interaction Screening**: Flag potential drug-drug interactions and contraindications
- **Allergy Cross-referencing**: Check medications against documented allergies and adverse reactions

Output Format:
1. **Current Medications List**:
   - Generic name (Brand name)
   - Dosage and strength
   - Route of administration
   - Frequency/schedule
   - Indication (if mentioned)

2. **Recently Discontinued**:
   - Medication name
   - Date discontinued (if available)
   - Reason for discontinuation (if mentioned)

3. **New Additions**:
   - Recently started medications
   - Start date (if available)
   - Prescribing indication

4. **Alerts & Considerations**:
   - Potential drug interactions
   - Allergy conflicts
   - Dosing concerns
   - Missing critical information

Key Requirements:
- Use standard medication nomenclature (generic names preferred)
- Include both prescription and over-the-counter medications
- Note herbal supplements and vitamins when mentioned
- Maintain patient confidentiality
- Flag any unclear or ambiguous medication references
- Provide systematic, organized output for clinical review

Always prioritize accuracy and completeness in medication documentation to support safe patient care.`,
        },
        userId,
      });

      // Return early because this function will set the selected assistant and assistants state.
      setIsLoadingAllAssistants(false);
      return;
    }

    setAssistants(userAssistants);

    const defaultAssistant = userAssistants.find(
      (assistant) => assistant.metadata?.is_default
    );
    if (!defaultAssistant) {
      // Update the first assistant to be the default assistant, then set it as the selected assistant.
      const firstAssistant = userAssistants.sort((a, b) => {
        return a.created_at.localeCompare(b.created_at);
      })[0];
      const updatedAssistant = await editCustomAssistant({
        editedAssistant: {
          is_default: true,
          iconData: {
            iconName:
              (firstAssistant.metadata?.iconName as string | undefined) ||
              "User",
            iconColor:
              (firstAssistant.metadata?.iconColor as string | undefined) ||
              "#000000",
          },
          description:
            (firstAssistant.metadata?.description as string | undefined) ||
            "Your default assistant.",
          name:
            firstAssistant.name?.toLowerCase() === "Untitled"
              ? "Default assistant"
              : firstAssistant.name,
          tools:
            (firstAssistant.config?.configurable?.tools as
              | AssistantTool[]
              | undefined) || undefined,
          systemPrompt:
            (firstAssistant.config?.configurable?.systemPrompt as
              | string
              | undefined) || undefined,
        },
        assistantId: firstAssistant.assistant_id,
        userId,
      });

      setSelectedAssistant(updatedAssistant);
    } else {
      setSelectedAssistant(defaultAssistant);
    }

    setIsLoadingAllAssistants(false);
  };

  const contextValue: AssistantContentType = {
    assistants,
    selectedAssistant,
    isLoadingAllAssistants,
    isDeletingAssistant,
    isCreatingAssistant,
    isEditingAssistant,
    getOrCreateAssistant,
    getAssistants,
    deleteAssistant,
    createCustomAssistant,
    editCustomAssistant,
    setSelectedAssistant,
  };

  return (
    <AssistantContext.Provider value={contextValue}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantContext() {
  const context = useContext(AssistantContext);
  if (context === undefined) {
    throw new Error(
      "useAssistantContext must be used within a AssistantProvider"
    );
  }
  return context;
}
