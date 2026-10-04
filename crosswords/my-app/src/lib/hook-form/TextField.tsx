import { Box } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form"
import { fieldHolder } from "./general";
import { getFieldError } from "./getFieldError";


interface iTextFieldProps {
    label: string;
    id?: string;
    name: string;
    type?: "text" | "password"
    helperText: string;
    autoComplete?: boolean;
}


const PSTextField = ({ label, name, type = "text", helperText, id, }: iTextFieldProps) => {
    if (!id) {
        id = `inpt_` + name;
    }
    const { control, formState: { errors }, } = useFormContext();
    const autoCompleteAttr = type === "password" ? "new-password" : "off";

    return <Controller
        name={name}
        control={control}
        render={(thing) => {

          //  console.log(name, errors)
            const { message, hasError } = getFieldError(errors, name);
            const hText: string = message ?? helperText;
            const error: boolean = hasError;

            const textFieldProps: TextFieldProps = {
                value: thing.field.value ? thing.field.value : '',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    thing.field.onChange(event.target.value);
                },
                type,
                error,
                label,
                helperText: hText,
                // Works on MUI v5 (prop passes straight to input)
                autoComplete: autoCompleteAttr,
                // v5 way to target the native <input>
                inputProps: {
                    autoComplete: autoCompleteAttr,
                    autoCapitalize: "off",
                    autoCorrect: "off",
                    spellCheck: false,
                },
                // v6 way (safe to include; ignored on v5)
                slotProps: {
                    input: {
                        autoComplete: autoCompleteAttr,
                        autoCapitalize: "off",
                        autoCorrect: "off",
                        spellCheck: false,
                    },
                } as any,
            }

            return <Box sx={{ ...fieldHolder }}>
                <TextField id={id} name={name} fullWidth {...textFieldProps} />

            </Box>

        }}


    />
}


export default PSTextField;