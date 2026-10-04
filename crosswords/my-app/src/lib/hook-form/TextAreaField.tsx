import { Box } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form";
import { fieldHolder } from "./general";
import { getFieldError } from "./getFieldError";

interface ITextAreaProps {
  label: string;
  name: string;
  id?: string;
  helperText: string;
  rows?: number;        // fixed rows
  minRows?: number;     // for auto-growing
  maxRows?: number;     // for auto-growing
  placeholder?: string;
  spellCheck?: boolean; // optional control
}

const PSTextArea = ({
  label,
  name,
  id,
  helperText,
  rows,
  minRows = 3,
  maxRows,
  placeholder,
  spellCheck = true,
}: ITextAreaProps) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={(thing) => {
        const { message, hasError } = getFieldError(errors, name);
        const hText: string = message ?? helperText;
        const error: boolean = hasError;

        const textFieldProps: TextFieldProps = {
          value: thing.field.value ?? "",
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
          ) => {
            thing.field.onChange(event.target.value);
          },
          error,
          label,
          helperText: hText,
          placeholder,
          multiline: true,
          ...(rows ? { rows } : { minRows, maxRows }),
        };

        return (
          <Box sx={{ ...fieldHolder }}>
            <TextField
              id={id}
              name={name}
              fullWidth
              {...textFieldProps}
              autoComplete="off"
              slotProps={{
                input: {
                  autoComplete: "off",
                  autoCorrect: "off",
                  autoCapitalize: "off",
                  spellCheck,
                },
                // textarea: {
                //   autoComplete: "off",
                //   autoCorrect: "off",
                //   autoCapitalize: "off",
                //   spellCheck,
                // },
              }}
            />
          </Box>
        );
      }}
    />
  );
};

export default PSTextArea;
